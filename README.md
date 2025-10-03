# AIS Fleet - Signal K Plugin

**Expand your maritime awareness beyond your AIS receiver's range**

Join the global maritime community at [aisfleet.com](https://aisfleet.com) and integrate cloud-sourced vessel data with your local AIS, giving you a comprehensive view of maritime traffic up to 100 nautical miles around your position.

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

### **AI-Powered Intelligence**
- **Natural Language Queries**: Ask questions about maritime traffic using our MCP server
- **Real-time Analysis**: Get instant answers about vessel movements and locations
- **Smart Filtering**: Find specific vessel types, sizes, or routes with simple questions

### **Community Powered**
- **Share & Receive**: Contribute your AIS data to help other mariners
- **Global Network**: Access vessel data from mariners worldwide
- **Configurable Range**: Choose your cloud data radius (10-100 nautical miles)

## 🤖 AI-Powered Vessel Intelligence

Connect to our MCP server at [mcp.aisfleet.com/sse](https://mcp.aisfleet.com/sse) and ask natural language questions about maritime traffic:

```
"Are there any cruise ships leaving Seattle now?"
"Show me cargo ships near the Panama Canal"
"What tankers are in the Singapore Strait?"
"Find fishing vessels off the coast of San Diego"
"Track the movement of vessel MMSI 367744020"
"Show me large cargo ships over 200 meters near Singapore"
```

## 🚀 Quick Start

1. **Install** the plugin through Signal K App Store
2. **Configure** submission interval and cloud radius in Plugin Config
3. **Open** the web interface from Signal K's webapp section
4. **See** both local and cloud vessels on the interactive map
5. **Join** the community at [aisfleet.com](https://aisfleet.com)

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

## 🔄 How It Works

1. **Collect**: Your local AIS data flows through Signal K
2. **Receive**: Fetch nearby vessels from the cloud (within your configured radius)
3. **Share**: Plugin periodically submits your data to the community
4. **Display**: All vessels appear together in Signal K and the web map
5. **AI**: Gives you a remote MCP server through https://mcp.aisfleet.com/sse so you can integrate it with your favorite LLM (e.g. "Are there any cruise ships leaving Seattle now?" or "Show me cargo ships near the Panama Canal")

## 🌐 Community Network

By using AIS Fleet, you become part of a collaborative network of mariners sharing AIS data. Visit [aisfleet.com](https://aisfleet.com) to explore the global vessel database and your contributions help create a comprehensive picture of maritime traffic for everyone.

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

