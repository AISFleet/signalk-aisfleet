# AIS Fleet - Signal K Plugin

**Expand your maritime awareness beyond your AIS receiver's range**

AIS Fleet integrates cloud-sourced vessel data with your local AIS, giving you a comprehensive view of maritime traffic up to 100 nautical miles around your position.

## 🌊 Key Features

### **See Over the Horizon**
- **Local AIS**: Real-time vessels from your AIS receiver (typically 20-30nm range)
- **Cloud AIS**: Community-sourced vessel data from up to 100nm radius
- **Combined View**: All vessels displayed together on an interactive map
- **Signal K Integration**: Cloud vessels appear in your Signal K data store alongside local AIS

### **Easy Visualization**
- **Interactive Web Map**: Real-time vessel positions with color-coded icons
- **Vessel Details**: Click any vessel for name, MMSI, speed, course, and dimensions
- **Live Updates**: Automatic position updates via WebSocket
- **Mobile Friendly**: Responsive design works on all devices

### **Community Powered**
- **Share & Receive**: Contribute your AIS data to help other mariners
- **Global Network**: Access vessel data from mariners worldwide
- **Configurable Range**: Choose your cloud data radius (10-100 nautical miles)

## 🚀 Quick Start

1. **Install** the plugin through Signal K App Store
2. **Configure** submission interval and cloud radius in Plugin Config
3. **Open** the web interface from Signal K's webapp section
4. **See** both local and cloud vessels on the interactive map

## ⚠️ Important Safety Notice

**THIS PLUGIN IS FOR SITUATIONAL AWARENESS ONLY**

- **Not for navigation**: Do not use this data for collision avoidance or navigation decisions
- **Not real-time**: Cloud data may be delayed or incomplete
- **Supplement only**: Use alongside proper radar, AIS receiver, and visual lookout
- **Local AIS priority**: Always trust your direct AIS receiver over cloud data

## Installation

### Via Signal K App Store (Recommended)
1. Open your Signal K server admin interface
2. Navigate to **App Store**
3. Search for "AIS Fleet"
4. Click **Install**

### Manual Installation
1. Navigate to your Signal K server's plugin directory
2. Clone or download this plugin:
   ```bash
   cd ~/.signalk/node_modules
   git clone https://github.com/itemir/signalk-aisfleet.git
   ```
3. Install dependencies:
   ```bash
   cd signalk-aisfleet
   npm install
   ```
4. Restart your Signal K server

### Development Installation
```bash
# Clone the repository
git clone https://github.com/itemir/signalk-aisfleet.git
cd signalk-aisfleet

# Install dependencies
npm install

# Link to your Signal K server
npm link
cd ~/.signalk
npm link signalk-aisfleet

# Restart Signal K server
```

## Configuration

1. Open Signal K server admin interface
2. Navigate to **Server → Plugin Config**
3. Find "AIS Fleet" and click **Configure**
4. Set the optional configuration:

### Configuration Settings

- **Submit Interval**: How often to share your data (1-15 minutes, default: 5)
- **Cloud Radius**: Range for fetching nearby vessels (10-100 nautical miles, default: 100)

*Note: Own vessel data is always included in submissions for identification purposes.*

## 🗺️ Web Interface

Access the interactive map through your Signal K server:

1. **Open** Signal K admin interface
2. **Click** "AIS Fleet" in the webapps section
3. **View** all vessels (local + cloud) on the map
4. **Click** any vessel for detailed information

### Map Features

- **Color-Coded Vessels**: Different colors for cargo, fishing, pleasure, tanker, etc.
- **Directional Icons**: Moving vessels show heading arrows, stationary vessels show circles
- **Vessel Details**: Click any vessel for name, MMSI, position, speed, and dimensions
- **Filter by Type**: Show/hide different vessel categories
- **Real-Time Updates**: Vessels move as new data arrives
- **Multiple Views**: Switch between street map and satellite imagery

## 🔄 How It Works

1. **Collect**: Your local AIS data flows through Signal K
2. **Share**: Plugin periodically submits your data to the community
3. **Receive**: Fetch nearby vessels from the cloud (within your configured radius)
4. **Display**: All vessels appear together in Signal K and the web map
5. **Update**: Real-time position updates keep everything current

## 🌐 Community Network

By using AIS Fleet, you become part of a collaborative network of mariners sharing AIS data. Your contributions help create a comprehensive picture of maritime traffic for everyone.

## 📋 Requirements

- Signal K server (Node.js version)
- Internet connection for cloud data
- Optional: AIS receiver for local data contribution

## 🛠️ Troubleshooting

**No vessels appearing on map**:
- Ensure plugin is enabled in Signal K Plugin Config
- Check internet connection for cloud data
- Verify AIS data is available in Signal K Data Browser

**Map not loading**:
- Access through Signal K admin interface → Webapps → AIS Fleet
- Check browser console for errors
- Try refreshing the page

**Need help?**
- Check Signal K server logs for error messages
- Visit Signal K community forums
- Report issues on the GitHub repository

---

*Part of the Signal K ecosystem - Open source data exchange for marine applications*