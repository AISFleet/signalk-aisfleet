# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Signal K plugin called "AIS Fleet" that monitors AIS (Automatic Identification System) vessels, displays them on an interactive web map, and submits their data to an external API at configurable intervals. Signal K is an open-source data exchange format for marine use.

## Architecture

### Plugin Structure
- `plugin/index.js` - Main plugin implementation
- `public/index.html` - Web interface with Leaflet.js map
- `public/app.js` - Frontend JavaScript for real-time vessel display
- `public/assets/icons/` - Plugin icons
- `package.json` - Signal K plugin metadata and dependencies
- Plugin follows Signal K plugin conventions with start/stop lifecycle and schema configuration

### Key Components
- **Vessel Data Collection**: Uses Signal K subscription manager with proper context filtering
- **Data Management**: Maintains in-memory map of vessel data, auto-removes stale data (>24h)
- **Web Interface**: Interactive Leaflet.js map showing vessels with real-time updates
- **WebSocket Integration**: Real-time vessel updates via Signal K WebSocket stream
- **Vessel Classification**: Color-coded icons based on AIS vessel type
- **Periodic Submission**: Configurable timer (1-15 minutes) for API submissions
- **HTTP Client**: Uses axios for REST API communication
- **Update Throttling**: Prevents duplicate processing with 2-second vessel update throttling

### Data Flow
1. Subscribe to all Signal K contexts using subscription manager (`context: '*'`)
2. Filter for vessel contexts (`vessels.*`) in delta handler
3. Process delta updates with throttling and deduplication
4. Maintain vessel state with change detection
5. Periodically aggregate and submit data to external API
6. Handle errors and logging throughout

## Development Commands

```bash
# Install dependencies
npm install

# Development with debug logging
DEBUG=signalk:plugin:aisfleet npm start

# Link for development
npm link
cd ~/.signalk && npm link aisfleet
```

## Configuration Schema

The plugin uses JSON Schema for configuration:
- `intervalMinutes`: Submission interval (1-15 min, default 5)

Own vessel data is always included for identification purposes.

## Built-in Configuration

- **API Endpoint**: Fixed to `https://aisfleet.com/api/vessels/report`
- **Authentication**: No API key - uses self MMSI and UUID for identification
- **Request Timeout**: Fixed at 30 seconds

## Signal K Integration

- Subscribes to all contexts using `app.subscriptionmanager.subscribe()` with `context: '*'`
- Filters for vessel contexts (`vessels.*`) in delta handler
- Processes delta format updates with timestamp and source information
- Implements throttling (2-second minimum between vessel updates)
- Value change detection to avoid processing duplicate data
- Accesses Signal K app context for self-vessel identification
- Uses Signal K logging (`app.debug`, `app.error`) for consistent output

### Subscription Pattern
```javascript
const vesselSubscription = {
  context: '*',           // All contexts
  subscribe: [{
    path: '*',            // All paths
    period: 5000          // 5-second updates
  }]
};
```

## Testing and Deployment

- Plugin designed for installation via Signal K App Store
- Manual installation to `~/.signalk/node_modules`
- Configuration via Signal K admin UI at Server → Plugin Config
- Monitor via Signal K server logs and debug output