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
- **Vessel Data Collection**: Subscribes to `vessels.*` context to monitor all AIS vessels
- **Data Management**: Maintains in-memory map of vessel data, auto-removes stale data (>24h)
- **Web Interface**: Interactive Leaflet.js map showing vessels with real-time updates
- **WebSocket Integration**: Real-time vessel updates via Signal K WebSocket stream
- **Vessel Classification**: Color-coded icons based on AIS vessel type
- **Periodic Submission**: Configurable timer (1-15 minutes) for API submissions
- **HTTP Client**: Uses axios for REST API communication

### Data Flow
1. Subscribe to Signal K vessel data streams
2. Process delta updates and maintain vessel state
3. Periodically aggregate and submit data to external API
4. Handle errors and logging throughout

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

- **API Endpoint**: Fixed to `https://marinehub.ai/api/vessels/report`
- **Authentication**: No API key - uses self MMSI and UUID for identification
- **Request Timeout**: Fixed at 30 seconds

## Signal K Integration

- Subscribes to vessel data using `app.subscriptionmanager`
- Processes delta format updates with timestamp and source information
- Accesses Signal K app context for self-vessel identification
- Uses Signal K logging (`app.debug`, `app.error`) for consistent output

## Testing and Deployment

- Plugin designed for installation via Signal K App Store
- Manual installation to `~/.signalk/node_modules`
- Configuration via Signal K admin UI at Server → Plugin Config
- Monitor via Signal K server logs and debug output