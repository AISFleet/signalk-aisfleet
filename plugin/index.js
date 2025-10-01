const axios = require('axios');

// Constants
const API_BASE_URL = 'https://aisfleet.com/api/';
const API_ENDPOINT = 'vessels/report/';
const API_URL = API_BASE_URL + API_ENDPOINT;
const NEARBY_API_ENDPOINT = 'vessels/nearby';
const NEARBY_API_URL = API_BASE_URL + NEARBY_API_ENDPOINT;
const REQUEST_TIMEOUT = 30000; // 30 seconds

module.exports = (app) => {
  let timer = null;
  let nearbyTimer = null;
  let unsubscribes = [];
  let settings = {};
  let radiusNm = 100; // Default radius in nautical miles
  let vesselData = new Map();
  let cloudVessels = new Set(); // Track vessels from cloud to avoid submitting them back
  let lastUndefinedLog = 0; // Track when we last logged undefined vessel warnings

  const plugin = {
    id: 'aisfleet',
    name: 'AIS Fleet',
    description: 'Monitors AIS vessels and submits them to an API at configurable intervals',

    start: (pluginSettings, restartPlugin) => {
      settings = pluginSettings;

      // Set default values if not provided
      const intervalMinutes = Math.min(Math.max(settings.intervalMinutes || 5, 1), 15);
      radiusNm = Math.min(Math.max(settings.radiusNauticalMiles || 100, 10), 100);
      app.debug(`AIS Fleet started - ${intervalMinutes}min intervals, ${radiusNm}nm radius`);

      // Subscribe to all vessel data using proper subscription manager pattern
      const vesselSubscription = {
        context: '*', // Subscribe to all contexts
        subscribe: [{
          path: '*', // Subscribe to all paths
          period: 5000 // Update every 5 seconds
        }]
      };

      app.subscriptionmanager.subscribe(
        vesselSubscription,
        unsubscribes,
        (error) => {
          if (error) {
            app.error('Vessel subscription error:', error);
          }
        },
        (delta) => {
          // Only process vessel contexts
          if (delta.context && delta.context.startsWith('vessels.')) {
            handleVesselUpdate(delta);
          }
        }
      );

      // Start periodic API submission
      startPeriodicSubmission(intervalMinutes);

      // Start periodic nearby vessels fetch
      startPeriodicNearbyFetch(intervalMinutes);
    },

    stop: () => {
      // Clear timers
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (nearbyTimer) {
        clearInterval(nearbyTimer);
        nearbyTimer = null;
      }

      // Unsubscribe from all subscriptions
      unsubscribes.forEach(f => f());
      unsubscribes = [];

      // Clear vessel data
      vesselData.clear();
      cloudVessels.clear();
    },

    schema: () => ({
      type: 'object',
      properties: {
        intervalMinutes: {
          type: 'number',
          title: 'Submit Interval (minutes)',
          description: 'How often to submit vessel data to the API',
          default: 5,
          minimum: 1,
          maximum: 15
        },
        radiusNauticalMiles: {
          type: 'number',
          title: 'Cloud Vessel Radius (nautical miles)',
          description: 'Radius for fetching nearby vessels from cloud API',
          default: 100,
          minimum: 10,
          maximum: 100
        }
      }
    })
  };

  function handleVesselUpdate(delta) {
    if (!delta.context || !delta.updates) return;

    // Extract vessel ID from context (e.g., "vessels.urn:mrn:imo:mmsi:123456789")
    const contextMatch = delta.context.match(/^vessels\.(.+)$/);
    if (!contextMatch) return;

    const vesselId = contextMatch[1];

    // Skip vessels with invalid IDs
    if (!vesselId || vesselId === 'undefined' || vesselId === 'null' || vesselId.includes('undefined')) {
      // Log only once per minute to reduce noise
      if (!lastUndefinedLog || Date.now() - lastUndefinedLog > 60000) {
        lastUndefinedLog = Date.now();
      }
      return;
    }

    const selfContext = app.getSelfPath('');

    // Initialize vessel data if not exists
    if (!vesselData.has(vesselId)) {
      vesselData.set(vesselId, {
        id: vesselId,
        context: delta.context,
        lastUpdate: 0,
        data: {}
      });
    }

    const vessel = vesselData.get(vesselId);

    const currentTime = Date.now();

    // Throttle updates per vessel (max once every 2 seconds)
    if (vessel.lastUpdate && (currentTime - vessel.lastUpdate) < 2000) {
      return;
    }

    vessel.lastUpdate = currentTime;
    let updateCount = 0;

    // Process updates
    delta.updates.forEach(update => {
      if (!update.values) return;

      update.values.forEach(value => {
        if (value.path && value.value !== undefined) {
          // Check if the value actually changed
          const currentData = vessel.data[value.path];
          if (!currentData || JSON.stringify(currentData.value) !== JSON.stringify(value.value)) {
            vessel.data[value.path] = {
              value: value.value,
              source: update.source,
              timestamp: update.timestamp || currentTime
            };
            updateCount++;
          }
        }
      });
    });

    // Removed verbose vessel update logging
  }

  function startPeriodicSubmission(intervalMinutes) {
    const intervalMs = intervalMinutes * 60 * 1000;

    timer = setInterval(async () => {
      try {
        await submitVesselData();
      } catch (error) {
        app.error('Failed to submit vessel data:', error.message || error);
        if (error.stack) {
          app.error('Error stack:', error.stack);
        }
      }
    }, intervalMs);
  }

  function cleanVesselData(vessel) {
    const cleanData = {};
    for (const [path, pathData] of Object.entries(vessel.data)) {
      if (pathData && pathData.value !== null && pathData.value !== undefined) {
        // Only include essential navigation data
        if (path.startsWith('navigation.') || path.startsWith('design.') || path === 'name') {
          cleanData[path] = {
            value: pathData.value,
            timestamp: pathData.timestamp
          };
        }
      }
    }

    return {
      id: vessel.id,
      context: vessel.context,
      lastUpdate: new Date(vessel.lastUpdate).toISOString(),
      data: cleanData
    };
  }

  async function submitBatch(vessels, batchNumber, totalBatches) {
    const selfUuid = app.selfId || null;
    let selfMmsi = null;

    try {
      const mmsiValue = app.getSelfPath('mmsi');
      if (mmsiValue) {
        selfMmsi = mmsiValue;
      }
    } catch (error) {
      if (selfUuid && selfUuid.includes('mmsi:')) {
        selfMmsi = selfUuid.split('mmsi:')[1];
      }
    }

    const payload = {
      timestamp: new Date().toISOString(),
      self: {
        uuid: selfUuid,
        mmsi: selfMmsi
      },
      vessels: vessels.map(cleanVesselData)
    };

    const requestConfig = {
      method: 'POST',
      url: API_URL,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SignalK-AISFleet/1.0.0'
      },
      timeout: REQUEST_TIMEOUT
    };

    app.debug(`Submitting ${vessels.length} vessels`);
    const response = await axios(requestConfig);
  }

  async function submitVesselData() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Filter out old vessels and invalid vessels
    const activeVessels = Array.from(vesselData.values()).filter(vessel => {
      const age = now - vessel.lastUpdate;
      if (age > maxAge) {
        vesselData.delete(vessel.id);
        cloudVessels.delete(vessel.id); // Clean up cloud vessels tracking too
        return false;
      }

      // Filter out vessels with invalid IDs
      if (!vessel.id || vessel.id === 'undefined' || vessel.id === 'null' || vessel.id.includes('undefined')) {
        vesselData.delete(vessel.id);
        cloudVessels.delete(vessel.id);
        return false;
      }

      // Filter out vessels with no useful data
      if (!vessel.data || Object.keys(vessel.data).length === 0) {
        return false;
      }

      // Filter out cloud vessels to prevent submission loops
      if (cloudVessels.has(vessel.id) || vessel.isCloudVessel) {
        return false;
      }

      return true;
    });

    if (activeVessels.length === 0) {
      return;
    }

    // Submit in batches of 100
    const batchSize = 100;
    const totalBatches = Math.ceil(activeVessels.length / batchSize);


    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = start + batchSize;
      const batch = activeVessels.slice(start, end);

      try {
        await submitBatch(batch, i + 1, totalBatches);

        // Small delay between batches to avoid overwhelming the API
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        if (error.response?.status >= 500) {
          app.debug(`Submission batch ${i + 1} server error: ${error.response.status}`);
        } else {
          app.debug(`Submission batch ${i + 1} failed: ${error.message}`);
        }
        // Continue with next batch rather than stopping everything
      }
    }
  }

  function startPeriodicNearbyFetch(intervalMinutes) {
    // Fetch nearby vessels at the same interval as submissions
    const intervalMs = intervalMinutes * 60 * 1000;

    nearbyTimer = setInterval(async () => {
      try {
        await fetchNearbyVessels();
      } catch (error) {
        app.error('Failed to fetch nearby vessels:', error.message || error);
        if (error.stack) {
          app.error('Error stack:', error.stack);
        }
      }
    }, intervalMs);
  }

  async function fetchNearbyVessels() {
    // Get self position
    const position = getSelfPosition();
    if (!position) {
      return;
    }

    // Get authentication info
    const selfUuid = app.selfId || null;
    let selfMmsi = null;

    try {
      const mmsiValue = app.getSelfPath('mmsi');
      if (mmsiValue) {
        selfMmsi = mmsiValue;
      }
    } catch (error) {
      if (selfUuid && selfUuid.includes('mmsi:')) {
        selfMmsi = selfUuid.split('mmsi:')[1];
      }
    }

    if (!selfMmsi && !selfUuid) {
      return;
    }

    // Build request parameters
    const params = new URLSearchParams({
      lat: position.latitude.toString(),
      lng: position.longitude.toString(),
      radius: radiusNm.toString()
    });

    if (selfMmsi) {
      params.append('mmsi', selfMmsi);
    }
    if (selfUuid) {
      params.append('uuid', selfUuid);
    }

    const requestConfig = {
      method: 'GET',
      url: `${NEARBY_API_URL}?${params.toString()}`,
      headers: {
        'User-Agent': 'SignalK-AISFleet/1.0.0'
      },
      timeout: REQUEST_TIMEOUT
    };

    try {
      app.debug(`Fetching nearby vessels (radius: ${radiusNm}nm)`);
      const response = await axios(requestConfig);
      const data = response.data;

      if (data.vessels && Array.isArray(data.vessels)) {
        if (data.vessels.length > 0) {

          // Log summary of retrieved vessels
          data.vessels.forEach(vessel => {
            const mmsi = vessel.mmsi || 'unknown';
            const name = vessel.name || 'unnamed';
            const pos = vessel.last_position ?
              `${vessel.last_position.latitude.toFixed(4)},${vessel.last_position.longitude.toFixed(4)}` :
              'no position';
            const nav = vessel.latest_navigation;
            const sog = nav && nav.speed_over_ground !== null ? `${nav.speed_over_ground.toFixed(1)}kn` : 'no speed';
            const cog = nav && nav.course_over_ground !== null ? `${nav.course_over_ground.toFixed(0)}°` : 'no course';

            const vesselId = `urn:mrn:imo:mmsi:${mmsi}`;
            const hasLocal = vesselData.has(vesselId);
            const isCloudData = hasLocal && (vesselData.get(vesselId).isCloudVessel || cloudVessels.has(vesselId));
            const status = hasLocal ? (isCloudData ? 'cloud' : 'local') : 'new';

          });
        }
        app.debug(`Retrieved ${data.vessels.length} cloud vessels`);
        await processCloudVessels(data.vessels);
      }
    } catch (error) {
      if (error.response?.status === 403) {
        app.debug('Nearby vessels: access denied');
      } else if (error.response?.status >= 500) {
        app.debug(`Nearby vessels: server error (${error.response.status})`);
      } else {
        app.debug(`Nearby vessels failed: ${error.message}`);
      }
      throw error;
    }
  }

  function getSelfPosition() {
    try {
      const position = app.getSelfPath('navigation.position');
      if (position && position.value && position.value.latitude && position.value.longitude) {
        return {
          latitude: position.value.latitude,
          longitude: position.value.longitude
        };
      }
    } catch (error) {
      // Ignore error, just return null
    }
    return null;
  }

  async function processCloudVessels(cloudVesselsList) {
    let processed = 0;
    let skipped = 0;
    let localDataPreferred = 0;
    let updated = 0;


    for (const cloudVessel of cloudVesselsList) {
      const mmsi = cloudVessel.mmsi;
      if (!mmsi || mmsi === 'undefined' || mmsi === 'null' || mmsi === '' || mmsi === null || mmsi === undefined) {
        skipped++;
        continue;
      }

      const vesselId = `urn:mrn:imo:mmsi:${mmsi}`;
      const context = `vessels.${vesselId}`;

      // Check if we already have this vessel locally
      if (vesselData.has(vesselId)) {
        const existingVessel = vesselData.get(vesselId);

        // Check if existing data is from cloud source or if cloud data is fresher
        const isExistingCloudData = existingVessel.isCloudVessel || cloudVessels.has(vesselId);


        if (!isExistingCloudData) {
          localDataPreferred++;
          continue;
        }

        // Both are cloud data, check if new data is fresher
        const cloudPosTime = cloudVessel.last_position?.timestamp;
        const cloudNavTime = cloudVessel.latest_navigation?.timestamp;
        const cloudTimeStr = cloudPosTime || cloudNavTime;

        // If no timestamp available, treat as fresh data
        let cloudTimestamp;
        if (cloudTimeStr) {
          cloudTimestamp = new Date(cloudTimeStr);
        } else {
          cloudTimestamp = new Date(); // Use current time if no timestamp
        }

        const existingTimestamp = new Date(existingVessel.lastUpdate);

        // Special case: if existing timestamp is very recent (within last 2 minutes), it was likely set to Date.now() during bulk loading
        const now = Date.now();
        const existingAge = now - existingVessel.lastUpdate;
        const twoMinutes = 2 * 60 * 1000;

        if (existingAge < twoMinutes) {
          // Update with actual cloud timestamp
        } else if (cloudTimestamp <= existingTimestamp) {
          skipped++;
          continue;
        }

        // Cloud data is fresher, update it
        updated++;
      } else {
        processed++;
      }

      // Mark this as a cloud vessel
      cloudVessels.add(vesselId);

      // Get the actual timestamp from cloud data
      const cloudPosTime = cloudVessel.last_position?.timestamp;
      const cloudNavTime = cloudVessel.latest_navigation?.timestamp;
      const actualTimestamp = cloudPosTime || cloudNavTime || new Date().toISOString();

      // Create vessel data structure
      const vesselDataObj = {
        id: vesselId,
        context: context,
        lastUpdate: new Date(actualTimestamp).getTime(),
        data: {},
        isCloudVessel: true
      };

      // Convert cloud vessel data to Signal K format
      if (cloudVessel.name) {
        vesselDataObj.data['name'] = {
          value: cloudVessel.name,
          timestamp: new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.call_sign) {
        vesselDataObj.data['communication.callsignVhf'] = {
          value: cloudVessel.call_sign,
          timestamp: new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.imo_number) {
        vesselDataObj.data['registrations.imo'] = {
          value: cloudVessel.imo_number,
          timestamp: new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.design_length) {
        vesselDataObj.data['design.length'] = {
          value: { overall: cloudVessel.design_length },
          timestamp: new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.design_beam) {
        vesselDataObj.data['design.beam'] = {
          value: cloudVessel.design_beam,
          timestamp: new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.design_draft) {
        vesselDataObj.data['design.draft'] = {
          value: { maximum: cloudVessel.design_draft },
          timestamp: new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.last_position) {
        vesselDataObj.data['navigation.position'] = {
          value: {
            latitude: cloudVessel.last_position.latitude,
            longitude: cloudVessel.last_position.longitude
          },
          timestamp: cloudVessel.last_position.timestamp || new Date().toISOString(),
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.latest_navigation) {
        const nav = cloudVessel.latest_navigation;
        const navTimestamp = nav.timestamp || new Date().toISOString();

        if (nav.course_over_ground !== null && nav.course_over_ground !== undefined) {
          vesselDataObj.data['navigation.courseOverGroundTrue'] = {
            value: nav.course_over_ground * Math.PI / 180, // Convert to radians
            timestamp: navTimestamp,
            source: 'aisfleet-cloud'
          };
        }

        if (nav.speed_over_ground !== null && nav.speed_over_ground !== undefined) {
          vesselDataObj.data['navigation.speedOverGround'] = {
            value: nav.speed_over_ground * 0.514444, // Convert knots to m/s
            timestamp: navTimestamp,
            source: 'aisfleet-cloud'
          };
        }

        if (nav.heading !== null && nav.heading !== undefined) {
          vesselDataObj.data['navigation.headingTrue'] = {
            value: nav.heading * Math.PI / 180, // Convert to radians
            timestamp: navTimestamp,
            source: 'aisfleet-cloud'
          };
        }

        if (nav.rate_of_turn !== null && nav.rate_of_turn !== undefined) {
          vesselDataObj.data['navigation.rateOfTurn'] = {
            value: nav.rate_of_turn * Math.PI / 180, // Convert to radians per second
            timestamp: navTimestamp,
            source: 'aisfleet-cloud'
          };
        }

        if (nav.navigation_status !== null && nav.navigation_status !== undefined) {
          vesselDataObj.data['navigation.state'] = {
            value: nav.navigation_status,
            timestamp: navTimestamp,
            source: 'aisfleet-cloud'
          };
        }
      }

      // If updating existing vessel, update its timestamp to the actual cloud data timestamp
      if (vesselData.has(vesselId)) {
        vesselDataObj.lastUpdate = new Date(actualTimestamp).getTime();
      }

      // Add vessel to our data store
      vesselData.set(vesselId, vesselDataObj);
      processed++;

      // Send data to Signal K but with safe delta format
      await sendVesselData(vesselDataObj);

      // Small delay every 50 vessels to allow WebSocket processing
      if (processed % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Log processing summary
    if (cloudVesselsList.length > 0) {
      app.debug(`Processed ${cloudVesselsList.length} cloud vessels`);
    }
  }

  async function sendVesselData(vessel) {
    try {
      // Create a proper Signal K delta message
      const delta = {
        context: vessel.context,
        updates: [{
          source: {
            label: 'aisfleet-cloud'
          },
          timestamp: new Date().toISOString(),
          values: []
        }]
      };

      // Only inject essential navigation data to avoid schema conflicts
      const safeSignalKPaths = [
        'navigation.position',
        'navigation.speedOverGround',
        'navigation.courseOverGroundTrue',
        'navigation.headingTrue',
        'navigation.rateOfTurn',
        'mmsi'
      ];

      for (const [path, pathData] of Object.entries(vessel.data)) {
        // Only process safe Signal K paths
        if (!safeSignalKPaths.includes(path)) {
          continue;
        }

        // Extract the actual value - could be raw value or Signal K object with .value property
        let actualValue;
        if (pathData && typeof pathData === 'object' && pathData.hasOwnProperty('value')) {
          actualValue = pathData.value;
        } else {
          actualValue = pathData;
        }


        // Only add if we have a valid value
        if (actualValue !== null && actualValue !== undefined) {
          delta.updates[0].values.push({
            path: path,
            value: actualValue
          });
        }
      }

      // Only send changing navigation data - skip static fields like names
      app.handleMessage(plugin.id, delta);


    } catch (error) {
      if (error.message.includes('Cannot create property')) {
        app.debug(`Schema error for vessel ${vessel.id} (cloud: ${vessel.isCloudVessel}): ${error.message}`);
      } else {
        app.debug(`Failed to inject vessel ${vessel.id}: ${error.message}`);
      }
    }
  }

  return plugin;
};
