const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Use Render's persistent file system - /tmp directory persists between deploys
const DATA_DIR = '/tmp/skogeohydro-data';
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const COORDINATES_FILE = path.join(DATA_DIR, 'coordinates.json');

// Ensure data directory exists
const ensureDataDirectory = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('✅ Created data directory:', DATA_DIR);
  }
};

// Read data from file (generic function)
const readData = async (filePath, defaultValue = []) => {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(filePath, 'utf8');
    console.log(`📁 Loaded data from ${filePath}`);
    return JSON.parse(data);
  } catch (error) {
    console.log(`📁 No data file found at ${filePath}, starting fresh`);
    return defaultValue;
  }
};

// Write data to file (generic function)
const writeData = async (filePath, data) => {
  await ensureDataDirectory();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`💾 Saved data to ${filePath}`);
};

// REPORTS API ROUTES

// Get all reports
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await readData(REPORTS_FILE);
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Submit new report
app.post('/api/reports', async (req, res) => {
  try {
    const { type, location, coordinates, description, severity, email, phone } = req.body;
    
    if (!type || !location || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const reports = await readData(REPORTS_FILE);
    
    const newReport = {
      id: Date.now().toString(),
      type,
      location,
      coordinates: coordinates || '',
      description,
      severity: severity || 'medium',
      email: email || '',
      phone: phone || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    reports.unshift(newReport);
    await writeData(REPORTS_FILE, reports);

    res.status(201).json({ 
      message: 'Report submitted successfully',
      report: newReport 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// Update report status
app.put('/api/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const reports = await readData(REPORTS_FILE);
    const reportIndex = reports.findIndex(report => report.id === id);

    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Report not found' });
    }

    reports[reportIndex].status = status;
    reports[reportIndex].updatedAt = new Date().toISOString();
    
    await writeData(REPORTS_FILE, reports);

    res.json({ 
      message: 'Report updated successfully',
      report: reports[reportIndex]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Delete report
app.delete('/api/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reports = await readData(REPORTS_FILE);
    const filteredReports = reports.filter(report => report.id !== id);

    if (reports.length === filteredReports.length) {
      return res.status(404).json({ error: 'Report not found' });
    }

    await writeData(REPORTS_FILE, filteredReports);
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// COORDINATES API ROUTES

// Get all coordinates
app.get('/api/coordinates', async (req, res) => {
  try {
    const coordinates = await readData(COORDINATES_FILE);
    res.json(coordinates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch coordinates' });
  }
});

// Submit new coordinates
app.post('/api/coordinates', async (req, res) => {
  try {
    const { name, lat, lng, transparency, temperature, conductivity, waterlevel, pathogens, description } = req.body;
    
    if (!name || !lat || !lng) {
      return res.status(400).json({ error: 'Missing required fields: name, lat, lng' });
    }

    const coordinates = await readData(COORDINATES_FILE);
    
    const newCoordinate = {
      id: Date.now().toString(),
      name,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      transparency: transparency ? parseFloat(transparency) : null,
      temperature: temperature ? parseFloat(temperature) : null,
      conductivity: conductivity ? parseFloat(conductivity) : null,
      waterlevel: waterlevel ? parseFloat(waterlevel) : null,
      pathogens: pathogens || 'Unknown',
      description: description || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    coordinates.unshift(newCoordinate);
    await writeData(COORDINATES_FILE, coordinates);

    res.status(201).json({ 
      message: 'Coordinates submitted successfully',
      coordinate: newCoordinate 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit coordinates' });
  }
});

// Update coordinate status
app.put('/api/coordinates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const coordinates = await readData(COORDINATES_FILE);
    const coordinateIndex = coordinates.findIndex(coord => coord.id === id);

    if (coordinateIndex === -1) {
      return res.status(404).json({ error: 'Coordinate not found' });
    }

    coordinates[coordinateIndex].status = status;
    coordinates[coordinateIndex].updatedAt = new Date().toISOString();
    
    await writeData(COORDINATES_FILE, coordinates);

    res.json({ 
      message: 'Coordinate updated successfully',
      coordinate: coordinates[coordinateIndex]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update coordinate' });
  }
});

// Delete coordinate
app.delete('/api/coordinates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const coordinates = await readData(COORDINATES_FILE);
    const filteredCoordinates = coordinates.filter(coord => coord.id !== id);

    if (coordinates.length === filteredCoordinates.length) {
      return res.status(404).json({ error: 'Coordinate not found' });
    }

    await writeData(COORDINATES_FILE, filteredCoordinates);
    res.json({ message: 'Coordinate deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete coordinate' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    dataDirectory: DATA_DIR
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'SKO GeoHydro Portal API',
    version: '1.0.0',
    dataPersists: true,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`🌐 Health check: http://0.0.0.0:${PORT}/health`);
});