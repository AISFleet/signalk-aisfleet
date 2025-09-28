const axios = require('axios');

// Constants
const API_BASE_URL = 'https://marinehub.ai/api/';
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

      // Subscribe to all vessel data
      const subscription = {
        context: 'vessels.*',
        subscribe: [
          {
            path: '*',
            period: 1000,
            minPeriod: 1000,
            format: 'delta',
            policy: 'instant'
          }
        ]
      };

      app.subscriptionmanager.subscribe(
        subscription,
        unsubscribes,
        (delta) => handleVesselUpdate(delta),
        (err) => app.error('Subscription error:', err)
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

    // Always include own vessel data

    // Initialize vessel data if not exists
    if (!vesselData.has(vesselId)) {
      vesselData.set(vesselId, {
        id: vesselId,
        context: delta.context,
        lastUpdate: Date.now(),
        data: {}
      });
    }

    const vessel = vesselData.get(vesselId);
    vessel.lastUpdate = Date.now();

    // Process updates
    delta.updates.forEach(update => {
      if (!update.values) return;

      update.values.forEach(value => {
        if (value.path && value.value !== undefined) {
          vessel.data[value.path] = {
            value: value.value,
            source: update.source
          };
        }
      });
    });

    app.debug(`Updated vessel ${vesselId} with ${delta.updates.length} updates`);
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