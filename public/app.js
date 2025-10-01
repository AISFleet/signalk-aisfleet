class MarineHubApp {
    constructor() {
        this.map = null;
        this.vessels = new Map();
        this.ws = null;
        this.selfVessel = null;
        this.visibleVesselTypes = new Set([
            'pleasure', 'sailing', 'cargo', 'tanker', 'passenger', 'fishing',
            'military', 'pilot', 'tug', 'law', 'other', 'unknown', 'self'
        ]); // All types visible by default

        this.vesselTypes = {
            // AIS vessel types mapped to colors
            pleasure: '#3498db',     // Blue
            sailing: '#c0392b',      // Dark red
            cargo: '#e74c3c',        // Red
            tanker: '#d35400',       // Dark orange
            passenger: '#f39c12',    // Orange
            fishing: '#16a085',      // Teal
            military: '#2c3e50',     // Dark blue-gray
            law: '#34495e',          // Dark gray
            pilot: '#7f8c8d',        // Medium gray
            tug: '#8e44ad',          // Purple
            other: '#95a5a6',        // Gray
            unknown: '#bdc3c7',      // Light gray
            self: '#27ae60'          // Green
        };

        this.init();
    }

    async initOld() {
        await this.init();
    }

    initMap() {
        // Initialize Leaflet map with world view
        this.map = L.map('map').setView([0, 0], 2);

        // Define base layers
        const baseLayers = {
            "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }),
            "Satellite View": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            })
        };

        // Add default layer (OpenStreetMap)
        baseLayers["OpenStreetMap"].addTo(this.map);

        // Add layer control
        L.control.layers(baseLayers).addTo(this.map);

        // Add scale control
        L.control.scale().addTo(this.map);
    }

    initLegendToggle() {
        // Add click handlers to legend items
        document.querySelectorAll('.legend-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const vesselType = item.dataset.vesselType;
                this.toggleVesselType(vesselType);
            });
        });

        // Add click handler for close button
        const closeBtn = document.getElementById('closeLegendBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hideLegend();
            });
        }

        // Add click handler for toggle button
        const toggleBtn = document.getElementById('toggleLegendBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showLegend();
            });
        }
    }

    toggleVesselType(vesselType) {
        if (this.visibleVesselTypes.has(vesselType)) {
            // Hide this vessel type
            this.visibleVesselTypes.delete(vesselType);
            document.querySelector(`[data-vessel-type="${vesselType}"]`).classList.add('disabled');
        } else {
            // Show this vessel type
            this.visibleVesselTypes.add(vesselType);
            document.querySelector(`[data-vessel-type="${vesselType}"]`).classList.remove('disabled');
        }

        // Update all vessel markers
        this.updateAllVesselVisibility();
    }

    hideLegend() {
        const legend = document.getElementById('vesselTypesLegend');
        const toggleBtn = document.getElementById('toggleLegendBtn');

        if (legend && toggleBtn) {
            legend.classList.add('hidden');
            toggleBtn.classList.add('visible');
        }
    }

    showLegend() {
        const legend = document.getElementById('vesselTypesLegend');
        const toggleBtn = document.getElementById('toggleLegendBtn');

        if (legend && toggleBtn) {
            legend.classList.remove('hidden');
            toggleBtn.classList.remove('visible');
        }
    }

    updateAllVesselVisibility() {
        this.vessels.forEach(vessel => {
            const vesselType = this.getVesselType(vessel);
            const isVisible = this.visibleVesselTypes.has(vesselType);

            if (vessel.marker) {
                if (isVisible) {
                    // Show marker
                    if (!this.map.hasLayer(vessel.marker)) {
                        vessel.marker.addTo(this.map);
                    }
                } else {
                    // Hide marker
                    if (this.map.hasLayer(vessel.marker)) {
                        this.map.removeLayer(vessel.marker);
                    }
                }
            }
        });
    }

    async init() {
        this.initMap();
        this.initLegendToggle();
        await this.loadAllVessels(); // Load all vessel data first
        this.initWebSocket();
        this.updateStatus('Loading vessel data...', false);
    }

    async loadAllVessels() {
        try {
            this.updateStatus('Loading vessel data...', false);
            const response = await fetch('/signalk/v1/api/vessels');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const vesselData = await response.json();
            let vesselCount = 0;

            // Process each vessel in the response
            Object.entries(vesselData).forEach(([vesselId, data]) => {
                if (vesselId === 'self') return; // Skip self, we'll handle it separately

                // Initialize vessel with complete data
                const vessel = {
                    id: vesselId,
                    context: `vessels.${vesselId}`,
                    data: data,
                    marker: null,
                    lastUpdate: Date.now() // Current time as initial timestamp
                };

                this.vessels.set(vesselId, vessel);

                // Display vessel on map if it has position data
                const position = this.getValue(vessel.data.navigation?.position);
                if (position && position.latitude && position.longitude) {
                    this.updateVesselOnMap(vessel);
                    vesselCount++;
                }
            });

            this.updateVesselCount();
            this.updateStatus(`Loaded ${vesselCount} vessels`, true);

        } catch (error) {
            console.error('Failed to load vessel data:', error);
            this.updateStatus('Failed to load vessel data', false);
        }
    }


    initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/signalk/v1/stream?subscribe=none`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.updateStatus('Connected to Signal K', true);

            // First, get self vessel position to center the map
            this.getSelfPosition();

            // Subscribe to all vessel data deltas - real-time updates
            this.ws.send(JSON.stringify({
                context: 'vessels.*',
                subscribe: [
                    {
                        path: '*',
                        period: 500,        // Request updates every 500ms
                        minPeriod: 250,     // Allow updates as fast as 250ms
                        format: 'delta',
                        policy: 'instant'   // Immediate delivery when data changes
                    }
                ]
            }));
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.updates) {
                    this.handleVesselUpdate(data);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.ws.onclose = () => {
            this.updateStatus('Disconnected from Signal K', false);
            // Attempt to reconnect after 5 seconds
            setTimeout(() => this.initWebSocket(), 5000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateStatus('Connection error', false);
        };
    }


    handleVesselUpdate(data) {
        if (!data.context || !data.updates) return;

        const vesselId = this.extractVesselId(data.context);
        if (!vesselId) return;

        // Check if this is self vessel position update for initial centering
        const isSelfVessel = data.context === 'vessels.self';
        let hasPositionUpdate = false;

        // Get existing vessel or create minimal one (shouldn't happen if loadAllVessels worked)
        let vessel = this.vessels.get(vesselId);
        if (!vessel) {
            console.log(`Creating new vessel ${vesselId} from delta (not in initial load)`);
            vessel = {
                id: vesselId,
                context: data.context,
                data: {},
                marker: null,
                lastUpdate: Date.now()
            };
            this.vessels.set(vesselId, vessel);

            // Debug: Track new vessels from WebSocket
            if (Math.random() < 0.1) { // Only log 10% to avoid spam
                console.log(`New vessel from WebSocket: ${vesselId}, total vessels: ${this.vessels.size}`);
            }
        }

        // Process delta updates - merge into existing data and find the latest actual data timestamp
        let latestDataTimestamp = vessel.lastUpdate || 0; // Start with existing timestamp and only update if we find newer data

        data.updates.forEach(update => {
            if (!update.values) return;

            update.values.forEach(value => {
                if (value.path && value.value !== undefined) {
                    // Navigate to the correct nested property and set value
                    const pathParts = value.path.split('.');
                    let current = vessel.data;

                    // Navigate to parent object
                    for (let i = 0; i < pathParts.length - 1; i++) {
                        if (!current[pathParts[i]]) {
                            current[pathParts[i]] = {};
                        }
                        current = current[pathParts[i]];
                    }

                    // Set the value in Signal K format
                    const lastPart = pathParts[pathParts.length - 1];
                    current[lastPart] = {
                        value: value.value,
                        source: update.source
                    };

                    // Update latest data timestamp from the actual AIS message reception time
                    if (update.timestamp) {
                        const updateTime = new Date(update.timestamp).getTime();
                        latestDataTimestamp = Math.max(latestDataTimestamp, updateTime);
                    }

                    // Track if position was updated
                    if (value.path === 'navigation.position') {
                        hasPositionUpdate = true;

                        // If this is self vessel position and map is still at world view, pan to it
                        if (isSelfVessel && this.map.getZoom() <= 3) {
                            const position = value.value;
                            if (position && position.latitude && position.longitude) {
                                this.map.flyTo([position.latitude, position.longitude], 12, {
                                    animate: true,
                                    duration: 2.0
                                });
                                console.log('Panning map to self vessel position from delta:', position);
                            }
                        }
                    }
                }
            });
        });

        // Set the vessel's lastUpdate to the actual latest data timestamp, not current time
        vessel.lastUpdate = latestDataTimestamp;

        // Update vessel marker and popup if position changed or if this is a new vessel
        if (hasPositionUpdate || !vessel.marker) {
            this.updateVesselOnMap(vessel);
        } else {
            // Even if position didn't change, update the popup content with latest data
            if (vessel.marker) {
                const popupContent = this.createPopupContent(vessel);
                vessel.marker.setPopupContent(popupContent);

                // If popup is currently open, force refresh it
                if (vessel.marker.getPopup() && vessel.marker.getPopup().isOpen()) {
                    vessel.marker.getPopup().setContent(popupContent);
                }

            }
        }

        this.updateVesselCount();
    }

    extractVesselId(context) {
        const match = context.match(/vessels\.(.+)/);
        return match ? match[1] : null;
    }

    updateVesselOnMap(vessel) {
        const position = this.getValue(vessel.data.navigation?.position);
        if (!position || !position.latitude || !position.longitude) {
            return;
        }

        const latLng = [position.latitude, position.longitude];

        // Remove existing marker
        if (vessel.marker) {
            this.map.removeLayer(vessel.marker);
        }

        // Create vessel marker
        const marker = this.createVesselMarker(vessel, latLng);
        vessel.marker = marker;

        // Only add to map if this vessel type is visible
        const vesselType = this.getVesselType(vessel);
        if (this.visibleVesselTypes.has(vesselType)) {
            marker.addTo(this.map);
        }

        // No auto-centering here - map is centered on self position at startup
    }

    createVesselMarker(vessel, latLng) {
        const vesselType = this.getVesselType(vessel);
        const color = this.vesselTypes[vesselType] || this.vesselTypes.unknown;

        // Determine if this is own vessel
        const isSelf = vessel.context.includes('self') || vessel.context === 'vessels.self';
        const finalColor = isSelf ? this.vesselTypes.self : color;

        // Check if vessel is stationary (SOG < 0.5 knots or no SOG data)
        const sog = this.getValue(vessel.data.navigation?.speedOverGround);
        const isStationary = !sog || sog < 0.257; // 0.257 m/s ≈ 0.5 knots

        let marker;

        if (isStationary) {
            // Create circle marker for stationary vessels
            const radius = isSelf ? 5 : 3;
            marker = L.circleMarker(latLng, {
                color: finalColor,
                fillColor: finalColor,
                fillOpacity: 0.6,
                radius: radius,
                weight: 1
            });
        } else {
            // Create arrow marker for moving vessels
            const cogTrue = this.getValue(vessel.data.navigation?.courseOverGroundTrue);
            const headingTrue = this.getValue(vessel.data.navigation?.headingTrue);
            const headingMagnetic = this.getValue(vessel.data.navigation?.headingMagnetic);
            const heading = cogTrue || headingTrue || headingMagnetic || 0;
            const headingDegrees = heading * (180 / Math.PI); // Convert radians to degrees

            // Create custom divIcon with rotation
            const icon = L.divIcon({
                html: this.createVesselIconHtml(finalColor, headingDegrees, isSelf),
                className: 'vessel-icon',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            marker = L.marker(latLng, { icon });
        }

        // Create popup content with real-time data
        const popupContent = this.createPopupContent(vessel);
        marker.bindPopup(popupContent, { maxWidth: 300 });

        return marker;
    }

    createVesselIconHtml(color, heading, isSelf) {
        const size = isSelf ? 24 : 20;

        return `
            <div style="
                width: ${size}px;
                height: ${size}px;
                transform: rotate(${heading}deg);
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <svg width="${size}" height="${size}" viewBox="0 0 20 20" style="shape-rendering: crispEdges;">
                    <path d="M10 1 L16 18 L10 14 L4 18 Z"
                          fill="${color}"
                          stroke="none"
                          opacity="1"/>
                </svg>
            </div>
        `;
    }

    getVesselType(vessel) {
        // Check if this is own vessel first
        const isSelf = vessel.context.includes('self') || vessel.context === 'vessels.self';
        if (isSelf) return 'self';

        // Try to determine vessel type from various data sources
        const aisShipTypeObj = this.getValue(vessel.data.design?.aisShipType);
        const aisShipTypeId = aisShipTypeObj?.id;
        const aisShipTypeName = aisShipTypeObj?.name;
        const vesselType = aisShipTypeId || this.getValue(vessel.data.design?.aisShipAndCargoType) || this.getValue(vessel.data.aisShipAndCargoType);
        const name = this.getValue(vessel.data.name);
        const mmsi = this.getValue(vessel.data.mmsi);


        // First try using AIS ship type name if available
        if (aisShipTypeName) {
            const lowerTypeName = aisShipTypeName.toLowerCase();
            if (lowerTypeName.includes('sailing')) {
                return 'sailing';
            }
            if (lowerTypeName.includes('fishing')) {
                return 'fishing';
            }
            if (lowerTypeName.includes('cargo')) {
                return 'cargo';
            }
            if (lowerTypeName.includes('tanker')) {
                return 'tanker';
            }
            if (lowerTypeName.includes('passenger')) {
                return 'passenger';
            }
            if (lowerTypeName.includes('pleasure')) {
                return 'pleasure';
            }
            if (lowerTypeName.includes('pilot')) {
                return 'pilot';
            }
            if (lowerTypeName.includes('tug')) {
                return 'tug';
            }
            if (lowerTypeName.includes('military')) {
                return 'military';
            }
        }

        // Then try using AIS ship type ID codes
        if (vesselType && typeof vesselType === 'number') {
            // AIS ship and cargo type codes (more comprehensive)
            if (vesselType >= 30 && vesselType <= 32) return 'fishing';
            if (vesselType === 35) return 'military';
            if (vesselType === 36 || vesselType === 37) return 'pleasure';
            if (vesselType >= 40 && vesselType <= 49) return 'passenger';
            if (vesselType >= 50 && vesselType <= 59) return 'pilot';
            if (vesselType >= 60 && vesselType <= 69) return 'passenger';
            if (vesselType >= 70 && vesselType <= 79) return 'cargo';
            if (vesselType >= 80 && vesselType <= 89) return 'tanker';
            if (vesselType >= 90 && vesselType <= 99) return 'other';
        }

        // Try to guess from name
        if (name && typeof name === 'string') {
            const lowerName = name.toLowerCase();
            if (lowerName.includes('fishing') || lowerName.includes('fish')) {
                return 'fishing';
            }
            if (lowerName.includes('cargo') || lowerName.includes('container')) {
                return 'cargo';
            }
            if (lowerName.includes('tanker') || lowerName.includes('oil')) {
                return 'tanker';
            }
            if (lowerName.includes('passenger') || lowerName.includes('ferry')) {
                return 'passenger';
            }
            if (lowerName.includes('pleasure') || lowerName.includes('yacht')) {
                return 'pleasure';
            }
            if (lowerName.includes('pilot')) {
                return 'pilot';
            }
            if (lowerName.includes('tug')) {
                return 'tug';
            }
            if (lowerName.includes('military') || lowerName.includes('navy')) {
                return 'military';
            }
            if (lowerName.includes('coast guard') || lowerName.includes('police')) {
                return 'law';
            }
        }

        // For demo purposes, assign some variety based on vessel ID hash
        const vesselTypes = ['cargo', 'tanker', 'fishing', 'pleasure', 'passenger'];
        const hash = vessel.id.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
        const result = vesselTypes[Math.abs(hash) % vesselTypes.length];
        return result;
    }

    // Helper function to get value from either direct value or Signal K value object
    getValue(obj) {
        if (obj === null || obj === undefined) return undefined;
        if (typeof obj === 'object' && obj.hasOwnProperty('value')) {
            return obj.value;
        }
        return obj;
    }

    // Helper function to convert decimal degrees to navigation notation (DD°MM.mmm')
    formatCoordinate(decimal, isLatitude) {
        if (decimal === null || decimal === undefined) return 'Unknown';

        const abs = Math.abs(decimal);
        const degrees = Math.floor(abs);
        const minutes = (abs - degrees) * 60;

        let direction;
        if (isLatitude) {
            direction = decimal >= 0 ? 'N' : 'S';
        } else {
            direction = decimal >= 0 ? 'E' : 'W';
        }

        return `${degrees}°${minutes.toFixed(3)}'${direction}`;
    }

    createPopupContent(vessel) {
        const name = this.getValue(vessel.data.name) ||
                    this.getValue(vessel.data.shipname) ||
                    this.getValue(vessel.data.design?.name) || 'Unknown';
        const mmsi = this.getValue(vessel.data.mmsi) ||
                    this.getValue(vessel.data.navigation?.gnss?.mmsi) || 'Unknown';
        const position = this.getValue(vessel.data.navigation?.position);
        const cog = this.getValue(vessel.data.navigation?.courseOverGroundTrue);
        const sog = this.getValue(vessel.data.navigation?.speedOverGround);
        const heading = this.getValue(vessel.data.navigation?.headingTrue) || this.getValue(vessel.data.navigation?.headingMagnetic);
        const length = this.getValue(vessel.data.design?.length?.overall) || this.getValue(vessel.data.design?.length) || this.getValue(vessel.data.design?.overallLength);
        const beam = this.getValue(vessel.data.design?.beam) || this.getValue(vessel.data.design?.breadth);
        const draft = this.getValue(vessel.data.design?.draft?.maximum) || this.getValue(vessel.data.design?.draft) || this.getValue(vessel.data.design?.maximumDraft);
        const vesselType = this.getVesselType(vessel);
        const callsign = this.getValue(vessel.data.communication?.callsignVhf) || this.getValue(vessel.data.callsign);

        // Debug removed for cleaner console

        // Format last updated time
        const lastUpdated = new Date(vessel.lastUpdate).toLocaleString();


        return `
            <div class="vessel-popup">
                <h3>${name}</h3>
                <div class="vessel-info">
                    <div class="label">MMSI:</div>
                    <div class="value">${mmsi}</div>

                    ${callsign ? `<div class="label">Call Sign:</div><div class="value">${callsign}</div>` : ''}

                    <div class="label">Type:</div>
                    <div class="value">${vesselType ? vesselType.charAt(0).toUpperCase() + vesselType.slice(1) : 'Unknown'}</div>

                    <div class="label">Position:</div>
                    <div class="value">${position && position.latitude && position.longitude ? `${this.formatCoordinate(position.latitude, true)}<br>${this.formatCoordinate(position.longitude, false)}` : 'Unknown'}</div>

                    ${cog ? `<div class="label">COG:</div><div class="value">${(cog * 180 / Math.PI).toFixed(1)}°</div>` : ''}

                    ${sog ? `<div class="label">SOG:</div><div class="value">${(sog * 1.94384).toFixed(1)} knots</div>` : ''}

                    ${heading ? `<div class="label">Heading:</div><div class="value">${(heading * 180 / Math.PI).toFixed(1)}°</div>` : ''}

                    ${(length && typeof length === 'number') ? `<div class="label">Length:</div><div class="value">${length.toFixed(1)}m</div>` : ''}
                    ${(beam && typeof beam === 'number') ? `<div class="label">Beam:</div><div class="value">${beam.toFixed(1)}m</div>` : ''}
                    ${(draft && typeof draft === 'number') ? `<div class="label">Draft:</div><div class="value">${draft.toFixed(1)}m</div>` : ''}

                    <div class="label">Last Updated:</div>
                    <div class="value">${lastUpdated}</div>
                </div>
            </div>
        `;
    }


    centerMapOnVessels() {
        const positions = [];
        this.vessels.forEach(vessel => {
            const pos = this.getValue(vessel.data.navigation?.position);
            if (pos && pos.latitude && pos.longitude) {
                positions.push([pos.latitude, pos.longitude]);
            }
        });

        if (positions.length > 0) {
            const group = new L.featureGroup(positions.map(pos => L.marker(pos)));
            this.map.fitBounds(group.getBounds(), { padding: [20, 20] });
        }
    }

    updateVesselCount() {
        // Count only vessels that have markers (are displayed on map)
        let visibleCount = 0;
        this.vessels.forEach(vessel => {
            if (vessel.marker) {
                visibleCount++;
            }
        });
        document.getElementById('vesselCount').textContent = `${visibleCount} vessels on map`;
    }

    updateStatus(message, connected) {
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const lastUpdate = document.getElementById('lastUpdate');

        statusIndicator.className = `status-indicator ${connected ? 'connected' : ''}`;
        statusText.textContent = message;

        if (connected) {
            lastUpdate.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
        }
    }

    // Get self vessel position and smoothly pan to it
    async getSelfPosition() {
        try {
            const response = await fetch('/signalk/v1/api/vessels/self/navigation/position');
            if (response.ok) {
                const data = await response.json();
                if (data.value && data.value.latitude && data.value.longitude) {
                    const selfPos = [data.value.latitude, data.value.longitude];
                    // Smooth pan to self position with appropriate zoom
                    this.map.flyTo(selfPos, 12, {
                        animate: true,
                        duration: 2.0 // 2 second animation
                    });
                    console.log('Panning map to self vessel position:', selfPos);
                    return;
                }
            }
        } catch (error) {
            console.log('Could not get self position via API:', error);
        }

        // Fallback: try to get self position from WebSocket
        this.ws.send(JSON.stringify({
            context: 'vessels.self',
            subscribe: [
                {
                    path: 'navigation.position',
                    period: 1000,
                    minPeriod: 1000,
                    format: 'delta',
                    policy: 'instant'
                }
            ]
        }));
    }

    // Clean up old vessels (called periodically)
    cleanupOldVessels() {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hour

        let removedCount = 0;
        this.vessels.forEach((vessel, id) => {
            if (now - vessel.lastUpdate > maxAge) {
                console.log(`Removing stale vessel ${id} (${this.getValue(vessel.data.name) || 'Unknown'})`);

                // Remove from map
                if (vessel.marker) {
                    this.map.removeLayer(vessel.marker);
                }


                // Remove from vessels
                this.vessels.delete(id);
                removedCount++;
            }
        });

        if (removedCount > 0) {
            console.log(`Cleaned up ${removedCount} stale vessels`);
            this.updateVesselCount();
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const app = new MarineHubApp();

    // Clean up old vessels every 5 minutes (now using 1-hour timeout)
    setInterval(() => app.cleanupOldVessels(), 5 * 60 * 1000);

    // Update status and connection info every 10 seconds for real-time feel
    setInterval(() => {
        if (app.ws && app.ws.readyState === WebSocket.OPEN) {
            app.updateStatus('Connected to Signal K', true);
        } else {
            app.updateStatus('Disconnected from Signal K', false);
        }
    }, 10 * 1000);

    // Update vessel count more frequently to reflect real-time changes
    setInterval(() => {
        app.updateVesselCount();
    }, 5 * 1000);
});
