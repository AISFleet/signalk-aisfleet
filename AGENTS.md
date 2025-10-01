# AGENTS.md

Architecture and Design Principles for AIS Fleet Signal K Plugin

## Architecture Overview

The AIS Fleet plugin implements a hybrid data approach, combining local AIS data from Signal K with cloud-sourced vessel data from the AIS Fleet community API. This creates a comprehensive maritime situational awareness system.

## Core Design Principles

### 1. Separation of Concerns

**Local AIS Data vs Cloud Data**
- **Local AIS**: Real-time data from nearby vessels received via AIS radio
- **Cloud Data**: Historical/cached data from community sources (configurable radius 10-100nm)
- **Hybrid Approach**: Combines both sources with local data taking precedence

**Data Types Separation**
- **Dynamic Data**: Position, speed, course, heading (changes frequently)
- **Static Data**: Vessel names, dimensions, design info (changes rarely)
- **Principle**: Only inject dynamic data into Signal K to avoid schema conflicts

### 2. Signal K Integration Strategy

**Selective Delta Injection**
```javascript
// Safe navigation paths only
const safeSignalKPaths = [
  'navigation.position',
  'navigation.speedOverGround',
  'navigation.courseOverGroundTrue',
  'navigation.headingTrue',
  'navigation.rateOfTurn',
  'mmsi'
];
```

**Why This Works**
- Avoids Signal K schema conflicts with vessel names
- Focuses on data that actually changes and needs real-time updates
- Reduces Signal K processing load
- Prevents "Cannot create property 'meta' on string" errors

### 3. Performance Optimization

**Throttling Strategy**
- **Local Updates**: 2-second minimum between vessel updates
- **Cloud Injection**: 100ms delay every 50 vessels
- **Batch Processing**: 100 vessels per API submission batch

**Memory Management**
- Auto-removes stale vessels (>24 hours)
- Efficient in-memory storage with Map data structure
- Prevents memory leaks in long-running server environments

### 4. Error Handling Philosophy

**Graceful Degradation**
- Continue processing other vessels if one fails
- Log errors but don't crash the plugin
- Separate error handling for different operation types

**Focused Logging**
```javascript
// Operation-specific debug messages
app.debug(`Submitting ${vessels.length} vessels`);
app.debug(`Fetching nearby vessels (radius: ${radiusNm}nm)`);
app.debug(`Retrieved ${data.vessels.length} cloud vessels`);
```

## Data Flow Architecture

### 1. Input Sources

**Signal K Subscription**
```javascript
const vesselSubscription = {
  context: '*',           // All contexts
  subscribe: [{
    path: '*',            // All paths
    period: 5000          // 5-second updates
  }]
};
```

**Cloud API Integration**
- Periodic fetching (configurable interval 1-15 minutes)
- Position-based queries (configurable radius 10-100nm, default 100nm)
- Authentication via self MMSI and UUID

### 2. Data Processing Pipeline

```
Local AIS → Delta Handler → Vessel Store ↘
                                         → Aggregator → API Submission
Cloud API → Converter → Delta Injection ↗
```

**Processing Steps**
1. **Input Validation**: Filter invalid vessel IDs and empty data
2. **Timestamp Comparison**: Prefer local data over cloud data
3. **Format Conversion**: Convert cloud data to Signal K format
4. **Selective Injection**: Only inject navigation data to Signal K
5. **Aggregation**: Combine all vessels for API submission

### 3. Output Destinations

**Signal K DataStore**
- Navigation data from both local and cloud sources
- Available to webapp via `/signalk/v1/api/vessels` endpoint
- Real-time updates via WebSocket

**AIS Fleet API**
- Periodic submission of all vessel data
- Batch processing for efficiency
- Error handling with retry logic

**Web Interface**
- Real-time map display
- Color-coded vessel classification
- Interactive vessel details

## Design Patterns

### 1. Plugin Pattern
Follows Signal K plugin conventions:
- Start/stop lifecycle management
- Schema-based configuration
- Standard logging integration

### 2. Observer Pattern
WebSocket-based real-time updates:
- Plugin publishes vessel deltas to Signal K
- Webapp subscribes to vessel updates
- Automatic UI updates on data changes

### 3. Producer-Consumer Pattern
Cloud vessel processing:
- Producer: Periodic API fetching
- Consumer: Delta injection with throttling
- Buffer: In-memory vessel storage

## Scalability Considerations

### 1. Memory Usage
- Efficient vessel storage with cleanup
- Bounded memory growth via stale data removal
- Optimized data structures (Map vs Object)

### 2. Network Efficiency
- Batch API requests (100 vessels per batch)
- Configurable update intervals
- Request timeout handling (30 seconds)

### 3. Signal K Load
- Selective delta injection (navigation data only)
- Throttled processing to prevent flooding
- Minimal WebSocket traffic

## Security Considerations

### 1. Input Validation
- Vessel ID validation and sanitization
- Data type checking for all inputs
- Protection against malformed API responses

### 2. Error Boundaries
- Isolated error handling per vessel
- No sensitive data in logs
- Graceful degradation on failures

### 3. API Security
- No hardcoded credentials
- Uses vessel identity for authentication
- Configurable timeout protection

## Future Extensibility

### 1. Plugin Architecture
- Modular design allows feature addition
- Configuration schema supports new options
- Standard Signal K integration patterns

### 2. Data Sources
- Easy to add new cloud data providers
- Pluggable data converters
- Flexible filtering and processing pipeline

### 3. Output Formats
- Multiple API endpoints supported
- Configurable data submission formats
- Extensible vessel classification system

## Lessons Learned

### 1. Signal K Schema Compatibility
**Problem**: Vessel names as strings caused schema conflicts
**Solution**: Only inject dynamic navigation data, skip static fields

### 2. WebSocket Performance
**Problem**: 1600+ simultaneous deltas overwhelmed WebSocket
**Solution**: Throttled injection with 100ms delays every 50 vessels

### 3. Data Precedence
**Problem**: Cloud data overwriting fresher local AIS data
**Solution**: Timestamp comparison with local data preference

### 4. Error Recovery
**Problem**: Single vessel errors stopping entire batch processing
**Solution**: Per-vessel error isolation with continue-on-error logic

This architecture provides a robust, scalable foundation for maritime vessel tracking that efficiently combines multiple data sources while maintaining Signal K compatibility and performance.