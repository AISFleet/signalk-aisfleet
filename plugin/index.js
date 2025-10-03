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
  let vesselData = new Map(); // Signal K vessels only
  let cloudVesselData = new Map(); // Cloud vessels only - separate storage
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

      // Add HTTP endpoint for cloud vessels
      app.get('/plugins/aisfleet/cloud-vessels', (req, res) => {
        try {
          const cloudVessels = Array.from(cloudVesselData.values());
          const responseData = {};

          cloudVessels.forEach(vessel => {
            responseData[vessel.id] = vessel.data;
          });

          res.json(responseData);
        } catch (error) {
          app.error('Error serving cloud vessels:', error);
          res.status(500).json({ error: 'Failed to retrieve cloud vessels' });
        }
      });
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
      cloudVesselData.clear();
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

      // If we had this vessel as cloud data, remove it since local data takes precedence
      if (cloudVesselData.has(vesselId)) {
        cloudVesselData.delete(vesselId);
        app.debug(`Promoted vessel ${vesselId} from cloud to local data`);
      }
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
        if (error.response?.status) {
          app.error(`Failed to submit vessel data: HTTP ${error.response.status} - ${error.response.statusText || 'Unknown error'}`);
          if (error.response.data) {
            app.error(`Response data: ${JSON.stringify(error.response.data)}`);
          }
        } else if (error.code) {
          app.error(`Failed to submit vessel data: ${error.code} - ${error.message}`);
        } else {
          app.error('Failed to submit vessel data:', error.message || 'Unknown error');
          app.error(`Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
        }
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

    app.debug(`Submitting ${vessels.length} vessels to ${API_URL}`);
    app.debug(`Payload self: ${JSON.stringify(payload.self)}`);
    app.debug(`First vessel sample: ${JSON.stringify(payload.vessels[0] || 'none')}`);
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
        cloudVesselData.delete(vessel.id); // Clean up cloud vessels tracking too
        return false;
      }

      // Filter out vessels with invalid IDs
      if (!vessel.id || vessel.id === 'undefined' || vessel.id === 'null' || vessel.id.includes('undefined')) {
        vesselData.delete(vessel.id);
        cloudVesselData.delete(vessel.id);
        return false;
      }

      // Filter out vessels with no useful data
      if (!vessel.data || Object.keys(vessel.data).length === 0) {
        return false;
      }

      // Filter out cloud vessels to prevent submission loops
      if (cloudVesselData.has(vessel.id) || vessel.isCloudVessel) {
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
          app.error(`Submission batch ${i + 1} server error: ${error.response.status}`);
          if (error.response.data) {
            app.error(`Server response: ${JSON.stringify(error.response.data)}`);
          }
        } else if (error.response?.status) {
          app.error(`Submission batch ${i + 1} HTTP error: ${error.response.status} - ${error.response.statusText || 'Unknown'}`);
          if (error.response.data) {
            app.error(`Error response: ${JSON.stringify(error.response.data)}`);
          }
        } else if (error.code) {
          app.error(`Submission batch ${i + 1} failed: ${error.code} - ${error.message}`);
        } else {
          app.error(`Submission batch ${i + 1} failed: ${error.message || 'Unknown error'}`);
          app.error(`Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
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
      app.debug('No self position available for nearby vessels fetch');
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
      app.debug('No MMSI or UUID available for nearby vessels fetch');
      return;
    }

    app.debug(`Fetching nearby vessels from position ${position.latitude},${position.longitude} with MMSI=${selfMmsi}, UUID=${selfUuid}`);

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
      app.debug(`Fetching nearby vessels from URL: ${requestConfig.url}`);
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
            const isCloudData = hasLocal && (vesselData.get(vesselId).isCloudVessel || cloudVesselData.has(vesselId));
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
      } else if (error.response?.status) {
        app.debug(`Nearby vessels: HTTP ${error.response.status} - ${error.response.statusText || 'Unknown error'}`);
        if (error.response.data) {
          app.debug(`Response data: ${JSON.stringify(error.response.data)}`);
        }
      } else if (error.code) {
        app.debug(`Nearby vessels: ${error.code} - ${error.message}`);
      } else {
        app.debug(`Nearby vessels failed: ${error.message || 'Unknown error'}`);
        app.debug(`Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
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

      // Check if we already have this vessel as cloud data
      if (cloudVesselData.has(vesselId)) {
        const existingVessel = cloudVesselData.get(vesselId);

        // Check if new cloud data is fresher
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

      // Check if we already have this vessel as local Signal K data - prefer local over cloud
      if (vesselData.has(vesselId)) {
        localDataPreferred++;
        continue; // Skip cloud vessel if we have local data for the same vessel
      }

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
          timestamp: actualTimestamp,
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.call_sign) {
        vesselDataObj.data['communication.callsignVhf'] = {
          value: cloudVessel.call_sign,
          timestamp: actualTimestamp,
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.imo_number) {
        vesselDataObj.data['registrations.imo'] = {
          value: cloudVessel.imo_number,
          timestamp: actualTimestamp,
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.design_length) {
        vesselDataObj.data['design.length'] = {
          value: { overall: cloudVessel.design_length },
          timestamp: actualTimestamp,
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.design_beam) {
        vesselDataObj.data['design.beam'] = {
          value: cloudVessel.design_beam,
          timestamp: actualTimestamp,
          source: 'aisfleet-cloud'
        };
      }

      if (cloudVessel.design_draft) {
        vesselDataObj.data['design.draft'] = {
          value: { maximum: cloudVessel.design_draft },
          timestamp: actualTimestamp,
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
      if (cloudVesselData.has(vesselId)) {
        vesselDataObj.lastUpdate = new Date(actualTimestamp).getTime();
      }

      // Add vessel to cloud data store only
      cloudVesselData.set(vesselId, vesselDataObj);

      // No longer send to Signal K - keep cloud vessels separate

      // Small delay every 50 vessels for processing
      if (processed % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Log processing summary
    if (cloudVesselsList.length > 0) {
      app.debug(`Processed ${cloudVesselsList.length} cloud vessels - added: ${processed}, updated: ${updated}, skipped: ${skipped}, local preferred: ${localDataPreferred}`);
    }
  }


  return plugin;
};
