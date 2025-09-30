const axios = require('axios');

// Constants
const API_BASE_URL = 'https://aisfleet.com/api/';
const API_ENDPOINT = 'vessels/report';
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

      app.debug('Starting AIS Fleet plugin with settings:', settings);

      // Set default interval if not provided
      const intervalMinutes = Math.min(Math.max(settings.intervalMinutes || 5, 1), 15);
      app.debug(`Using interval: ${intervalMinutes} minutes`);

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
          } else {
            app.debug('Successfully subscribed to vessel data');
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

      app.debug('AIS Fleet plugin started successfully');
    },

    stop: () => {
      app.debug('Stopping AIS Fleet plugin');

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

    if (updateCount > 0) {
      app.debug(`Updated vessel ${vesselId} with ${updateCount} new values (paths: ${Object.keys(vessel.data).join(', ')})`);
    }
  }

  function startPeriodicSubmission(intervalMinutes) {
    const intervalMs = intervalMinutes * 60 * 1000;

    timer = setInterval(async () => {
      try {
        await submitVesselData();
      } catch (error) {
        app.error('Failed to submit vessel data:', error.message);
      }
    }, intervalMs);

    app.debug(`Started periodic submission every ${intervalMinutes} minutes`);
  }

  async function submitVesselData() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Filter out old vessels (haven't been updated in 24 hours)
    const activeVessels = Array.from(vesselData.values()).filter(vessel => {
      const age = now - vessel.lastUpdate;
      if (age > maxAge) {
        vesselData.delete(vessel.id);
        return false;
      }
      return true;
    });

    if (activeVessels.length === 0) {
      app.debug('No active vessels to submit');
      return;
    }

    // Get self vessel information
    const selfContext = app.getSelfPath('');
    const selfUuid = app.selfId || null;
    const selfMmsi = app.getSelfPath('mmsi') ? app.getPath(app.getSelfPath('mmsi')) : null;

    const payload = {
      timestamp: new Date().toISOString(),
      self: {
        uuid: selfUuid,
        mmsi: selfMmsi,
        context: selfContext
      },
      vessels: activeVessels.map(vessel => ({
        id: vessel.id,
        context: vessel.context,
        lastUpdate: new Date(vessel.lastUpdate).toISOString(),
        data: vessel.data
      }))
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

    app.debug(`Submitting ${activeVessels.length} vessels to API`);

    try {
      const response = await axios(requestConfig);
      app.debug(`Successfully submitted vessel data. Status: ${response.status}`);
    } catch (error) {
      if (error.response) {
        app.error(`API request failed with status ${error.response.status}: ${error.response.statusText}`);
      } else if (error.request) {
        app.error('API request timeout or network error');
      } else {
        app.error('Failed to prepare API request:', error.message);
      }
      throw error;
    }
  }

  return plugin;
};