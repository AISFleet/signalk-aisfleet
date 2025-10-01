const axios = require('axios');

// Constants
const API_BASE_URL = 'https://aisfleet.com/api/';
const API_ENDPOINT = 'vessels/report/';
const API_URL = API_BASE_URL + API_ENDPOINT;
const REQUEST_TIMEOUT = 30000; // 30 seconds

module.exports = (app) => {
  let timer = null;
  let unsubscribes = [];
  let settings = {};
  let vesselData = new Map();

  const plugin = {
    id: 'aisfleet',
    name: 'AIS Fleet',
    description: 'Monitors AIS vessels and submits them to an API at configurable intervals',

    start: (pluginSettings, restartPlugin) => {
      settings = pluginSettings;

      // Set default interval if not provided
      const intervalMinutes = Math.min(Math.max(settings.intervalMinutes || 5, 1), 15);

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
    },

    stop: () => {
      // Clear timer
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      // Unsubscribe from all subscriptions
      unsubscribes.forEach(f => f());
      unsubscribes = [];

      // Clear vessel data
      vesselData.clear();
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

    app.debug(`Batch ${batchNumber}/${totalBatches}: ${vessels.length} vessels`);

    const response = await axios(requestConfig);
    app.debug(`Batch ${batchNumber} successful. Status: ${response.status}`);
  }

  async function submitVesselData() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Filter out old vessels and invalid vessels
    const activeVessels = Array.from(vesselData.values()).filter(vessel => {
      const age = now - vessel.lastUpdate;
      if (age > maxAge) {
        vesselData.delete(vessel.id);
        return false;
      }

      // Filter out vessels with invalid IDs
      if (!vessel.id || vessel.id === 'undefined' || vessel.id === 'null') {
        vesselData.delete(vessel.id);
        return false;
      }

      // Filter out vessels with no useful data
      if (!vessel.data || Object.keys(vessel.data).length === 0) {
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
        if (error.response) {
          app.error(`Batch ${i + 1} failed with status ${error.response.status}: ${error.response.statusText}`);
          if (error.response.data) {
            app.error('API Error Details:', JSON.stringify(error.response.data, null, 2));
          }
        } else if (error.request) {
          app.error(`Batch ${i + 1} timeout or network error`);
        } else {
          app.error(`Batch ${i + 1} prepare error:`, error.message);
        }
        // Continue with next batch rather than stopping everything
      }
    }
  }

  return plugin;
};
