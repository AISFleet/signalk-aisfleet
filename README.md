# MarineHub

A Signal K plugin that monitors AIS vessels, displays them on an interactive web map, and submits their data to an external API at configurable intervals.

## Features

- **Real-time AIS Monitoring**: Tracks all available AIS vessels in the Signal K data stream
- **Interactive Web Map**: Leaflet.js-based map with multiple layers (street map + satellite imagery)
- **Advanced Vessel Classification**: Intelligent AIS ship type detection with distinct vessel categories
- **Closeable Vessel Types Window**: Close and re-open the vessel types legend with dedicated buttons
- **Clickable Category Filtering**: Toggle vessel types on/off by clicking legend items
- **Directional Vessel Icons**: Moving vessels show as arrows with heading, stationary vessels as circles
- **Maritime Coordinate Display**: Proper navigation notation (DD°MM.mmm'N/S/E/W format)
- **Detailed Vessel Information**: Click any vessel for popup with comprehensive vessel details
- **Live Data Updates**: WebSocket connection provides real-time vessel movement
- **Optimized Data Handling**: Simplified data structure without flattening for better performance
- **Configurable Intervals**: Submit data every 1-15 minutes (default: 5 minutes)
- **Automatic Data Management**: Removes vessels that haven't been updated in 24 hours
- **API Integration**: Submits optimized vessel data to MarineHub.ai for analysis
- **Self Identification**: Own vessel data is always included for server identification

## Installation

### Via Signal K App Store (Recommended)
1. Open your Signal K server admin interface
2. Navigate to **App Store**
3. Search for "MarineHub"
4. Click **Install**

### Manual Installation
1. Navigate to your Signal K server's plugin directory
2. Clone or download this plugin:
   ```bash
   cd ~/.signalk/node_modules
   git clone https://github.com/itemir/signalk-marinehub.git
   ```
3. Install dependencies:
   ```bash
   cd signalk-marinehub
   npm install
   ```
4. Restart your Signal K server

### Development Installation
```bash
# Clone the repository
git clone https://github.com/itemir/signalk-marinehub.git
cd signalk-marinehub

# Install dependencies
npm install

# Link to your Signal K server
npm link
cd ~/.signalk
npm link signalk-marinehub

# Restart Signal K server
```

## Configuration

1. Open Signal K server admin interface
2. Navigate to **Server → Plugin Config**
3. Find "MarineHub" and click **Configure**
4. Set the optional configuration:

### Configuration Settings

- **Submit Interval**: How often to submit data (1-15 minutes, default: 5)

*Note: Own vessel data is always included in submissions for identification purposes.*

## Web Interface

The plugin provides a web-based map interface accessible through the Signal K server:

1. **Access the Map**: Navigate to your Signal K server's web interface
2. **Find MarineHub**: Look for "MarineHub AIS Tracker" in the web apps section
3. **View Vessels**: The map displays all AIS vessels with color-coded icons
4. **Map Initialization**: Starts with world view showing global vessel traffic, then smoothly pans to your vessel's location

### Map Features

- **Dynamic Vessel Icons**:
  - Moving vessels: Directional arrows showing heading
  - Stationary vessels: Small colored circles (SOG < 0.5 knots)
- **Closeable Vessel Types Legend**: Use the close button (×) to hide the legend, then click "Show Vessel Types" to reopen
- **Clickable Legend Filtering**: Click any vessel type in the legend to show/hide that category
- **Enhanced Color Coding**: Distinct colors for all vessel types:
  - 🔵 Blue: Pleasure craft
  - 🔴 Dark Red: Sailing vessels
  - 🔴 Red: Cargo vessels
  - 🟠 Dark Orange: Tankers
  - 🟠 Orange: Passenger vessels
  - 🟢 Teal: Fishing vessels
  - ⚫ Dark Blue-Gray: Military vessels
  - 🔘 Dark Gray: Law enforcement
  - 🔘 Medium Gray: Pilot vessels
  - 🟣 Purple: Tug boats
  - 🔘 Gray: Other vessels
  - 🔘 Light Gray: Unknown types
  - 🟢 Green: Own vessel

- **Interactive Popups**: Click any vessel to see:
  - Vessel name and MMSI
  - Current position in maritime notation (37°46.494'N / 122°25.164'W)
  - Course over ground (COG) - only if available
  - Speed over ground (SOG) - only if available
  - Heading - only if available
  - Vessel dimensions (length, beam, draft) - if available
  - Vessel type and call sign
  - Last update time

- **Multiple Map Layers**: Switch between OpenStreetMap and Satellite View via layer control
- **Smart Initialization**: Starts with world view, then smoothly pans to own vessel location
- **Real-time Updates**: Vessels move in real-time as new AIS data arrives
- **Smart Display**: Unknown navigation values are hidden instead of showing "Unknown"
- **Layer Control**: Top-right control allows switching between map and satellite imagery

## API Data Format

The plugin submits optimized vessel data as JSON POST requests to `https://marinehub.ai/api/vessels/report`.

**Timestamp Optimization**: Individual data fields no longer include redundant timestamps. Timing information is provided via:
- Main payload `timestamp` (when report was generated)
- Per-vessel `lastUpdate` (when vessel was last seen)

This reduces payload size significantly while maintaining essential timing information.

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "self": {
    "uuid": "urn:mrn:signalk:uuid:12345678-1234-1234-1234-123456789012",
    "mmsi": "123456789",
    "context": "vessels.self"
  },
  "vessels": [
    {
      "id": "urn:mrn:imo:mmsi:123456789",
      "context": "vessels.urn:mrn:imo:mmsi:123456789",
      "lastUpdate": "2025-01-15T10:29:45.000Z",
      "data": {
        "navigation.position": {
          "value": {
            "latitude": 37.7749,
            "longitude": -122.4194
          },
          "source": "ais.0"
        },
        "navigation.courseOverGround": {
          "value": 1.57,
          "source": "ais.0"
        },
        "navigation.speedOverGround": {
          "value": 5.14,
          "source": "ais.0"
        },
        "name": {
          "value": "VESSEL NAME",
          "source": "ais.0"
        }
      }
    }
  ]
}
```

### Request Headers

- `Content-Type: application/json`
- `User-Agent: SignalK-MarineHub/1.0.0`

## Troubleshooting

### Enable Debug Logging
1. In Signal K admin interface, go to **Server → Settings**
2. Enable "Enable Debug Log"
3. Or set environment variable: `DEBUG=signalk:plugin:marinehub`

### Common Issues

**No vessels appearing**:
- Verify AIS data is being received by Signal K
- Check that vessels appear in the Data Browser
- Ensure plugin is enabled and started

**API submission failures**:
- Check network connectivity to marinehub.ai
- Review server logs for detailed error messages
- Verify Signal K server has valid self identification (MMSI/UUID)

**High memory usage**:
- Plugin automatically removes vessels older than 24 hours
- Consider reducing submission interval for busy areas

### Log Messages

- `Starting MarineHub plugin`: Plugin initialization
- `Updated vessel X with N updates`: Vessel data received
- `Submitting N vessels to API`: API submission attempt
- `Successfully submitted vessel data`: Successful API call
- `API request failed`: Check API endpoint and authentication

## Development

### Project Structure
```
/
├── plugin/
│   └── index.js          # Main plugin code
├── public/
│   ├── index.html        # Web interface
│   ├── app.js           # Frontend JavaScript
│   └── assets/
│       └── icons/        # Plugin icons
├── package.json          # Plugin metadata and dependencies
├── README.md            # This file
└── CLAUDE.md            # Development notes
```

### Testing
```bash
# Install development dependencies
npm install

# Run with debug logging
DEBUG=signalk:plugin:marinehub npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

Apache 2.0 License - see LICENSE file for details.

## Support

- **Issues**: Report bugs or feature requests on GitHub
- **Documentation**: Signal K plugin development guide
- **Community**: Signal K Slack or forums