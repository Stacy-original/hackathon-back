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
const DATA_FILE = path.join(DATA_DIR, 'reports.json');

// Ensure data directory exists
const ensureDataDirectory = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('✅ Created data directory:', DATA_DIR);
  }
};

// Read reports from file
const readReports = async () => {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(DATA_FILE, 'utf8');
    console.log('📁 Loaded data from file');
    return JSON.parse(data);
  } catch (error) {
    console.log('📁 No data file found, starting fresh');
    return [];
  }
};

// Write reports to file
const writeReports = async (reports) => {
  await ensureDataDirectory();
  await fs.writeFile(DATA_FILE, JSON.stringify(reports, null, 2));
  console.log('💾 Saved data to file');
};

// API Routes

// Get all reports
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await readReports();
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

    const reports = await readReports();
    
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
    await writeReports(reports);

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

    const reports = await readReports();
    const reportIndex = reports.findIndex(report => report.id === id);

    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Report not found' });
    }

    reports[reportIndex].status = status;
    reports[reportIndex].updatedAt = new Date().toISOString();
    
    await writeReports(reports);

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
    const reports = await readReports();
    const filteredReports = reports.filter(report => report.id !== id);

    if (reports.length === filteredReports.length) {
      return res.status(404).json({ error: 'Report not found' });
    }

    await writeReports(filteredReports);
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete report' });
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