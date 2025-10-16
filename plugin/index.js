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
      const intervalMinutes = Math.min(Math.max(settings.intervalMinutes || 5, 5), 30);
      radiusNm = Math.min(Math.max(settings.radiusNauticalMiles || 100, 10), 100);
      app.debug(`AIS Fleet plugin started - ${intervalMinutes}min intervals, ${radiusNm}nm radius`);

      // No subscription needed - we'll get vessel data directly when needed

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

      // No subscriptions to unsubscribe from

      // Clear vessel data
      vesselData.clear();
      cloudVesselData.clear();
      app.debug('AIS Fleet plugin stopped');
    },

    schema: () => ({
      type: 'object',
      properties: {
        intervalMinutes: {
          type: 'number',
          title: 'Submit Interval (minutes)',
          description: 'How often to submit vessel data to the API',
          default: 5,
          minimum: 5,
          maximum: 30
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

  function updateVesselDataFromSignalK() {
    try {
      const allVessels = app.getPath('vessels');
      if (!allVessels || typeof allVessels !== 'object') {
        return;
      }

      const currentTime = Date.now();

      // Clear old vessel data and rebuild from current Signal K state
      vesselData.clear();

      Object.keys(allVessels).forEach(vesselKey => {
        const vesselData_sk = allVessels[vesselKey];
        if (!vesselData_sk || typeof vesselData_sk !== 'object') return;

        const vesselId = vesselKey;
        const context = `vessels.${vesselId}`;

        // Skip vessels with invalid IDs
        if (!vesselId || vesselId === 'undefined' || vesselId === 'null' || vesselId.includes('undefined') || vesselId === 'self') {
          return;
        }

        // Convert Signal K data format to our internal format
        const vesselDataObj = {
          id: vesselId,
          context: context,
          lastUpdate: currentTime,
          data: {}
        };

        // Recursively process all paths in the vessel data
        function processPath(obj, currentPath = '') {
          if (obj && typeof obj === 'object') {
            if (obj.value !== undefined) {
              // This is a value object with timestamp
              vesselDataObj.data[currentPath] = {
                value: obj.value,
                source: obj.source || 'signalk',
                timestamp: obj.timestamp || new Date().toISOString()
              };

            } else {
              // This is a container object, recurse into it
              Object.keys(obj).forEach(key => {
                const newPath = currentPath ? `${currentPath}.${key}` : key;
                processPath(obj[key], newPath);
              });
            }
          }
        }

        processPath(vesselData_sk);

        // Only add vessels that have useful data
        if (Object.keys(vesselDataObj.data).length > 0) {
          vesselData.set(vesselId, vesselDataObj);

          // If we had this vessel as cloud data, remove it since local data takes precedence
          if (cloudVesselData.has(vesselId)) {
            cloudVesselData.delete(vesselId);
          }
        }
      });
    } catch (error) {
      app.error('Error updating vessel data from Signal K:', error);
    }
  }

  function startPeriodicSubmission(intervalMinutes) {
    const intervalMs = intervalMinutes * 60 * 1000;

    timer = setInterval(async () => {
      try {
        // Update vessel data from Signal K before submitting
        updateVesselDataFromSignalK();
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
    let nameFound = false;

    for (const [path, pathData] of Object.entries(vessel.data)) {
      if (pathData && pathData.value !== null && pathData.value !== undefined) {

        // Include essential navigation data and name-related paths
        if (path.startsWith('navigation.') ||
            path.startsWith('design.') ||
            path === 'name' ||
            path.startsWith('communication.') ||
            path.startsWith('registrations.')) {
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


    const vesselsWithNames = payload.vessels.filter(v =>
      v.data.name ||
      v.data['design.name'] ||
      v.data['communication.callsignVhf'] ||
      Object.keys(v.data).some(key =>
        key.includes('name') ||
        key.includes('Name') ||
        key.startsWith('communication.') ||
        key.startsWith('registrations.')
      )
    );

    app.debug(`Batch ${batchNumber}/${totalBatches}: ${vessels.length} vessels (${vesselsWithNames.length} with names)`);



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

    const response = await axios(requestConfig);
    app.debug(`API submission successful: ${response.status} ${response.statusText}`);
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
      app.debug('No active vessels to submit');
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
          app.error(`API submission batch ${i + 1}/${totalBatches} server error: ${error.response.status}`);
        } else if (error.response?.status) {
          app.error(`API submission batch ${i + 1}/${totalBatches} HTTP error: ${error.response.status} - ${error.response.statusText || 'Unknown'}`);
        } else if (error.code) {
          app.error(`API submission batch ${i + 1}/${totalBatches} failed: ${error.code} - ${error.message}`);
        } else {
          app.error(`API submission batch ${i + 1}/${totalBatches} failed: ${error.message || 'Unknown error'}`);
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

    app.debug(`Fetching nearby vessels from AIS Fleet API (radius: ${radiusNm}nm)`);
    try {
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
        app.debug(`Retrieved ${data.vessels.length} cloud vessels from API`);
        await processCloudVessels(data.vessels);
      }
    } catch (error) {
      if (error.response?.status >= 500) {
        app.debug(`API fetch failed: server error ${error.response.status}`);
      } else if (error.response?.status === 403) {
        app.debug('API fetch failed: access denied');
      } else if (error.response?.status) {
        app.debug(`API fetch failed: HTTP ${error.response.status}`);
      } else {
        app.debug(`API fetch failed: ${error.message || 'Unknown error'}`);
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
      // Store MMSI explicitly
      vesselDataObj.data['mmsi'] = {
        value: mmsi,
        timestamp: actualTimestamp,
        source: 'aisfleet-cloud'
      };

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
