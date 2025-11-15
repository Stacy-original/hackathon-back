// server.js - COMPLETE FIXED VERSION
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Data file path
const DATA_FILE = path.join(__dirname, 'data', 'reports.json');

// Ensure data directory exists
const ensureDataDirectory = async () => {
  const dataDir = path.dirname(DATA_FILE);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
};

// Read reports from file
const readReports = async () => {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Return empty array if file doesn't exist
    return [];
  }
};

// Write reports to file
const writeReports = async (reports) => {
  await ensureDataDirectory();
  await fs.writeFile(DATA_FILE, JSON.stringify(reports, null, 2));
};

// ✅ ROOT ROUTE - Add this!
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 SKO GeoHydro Portal API is running!',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      getAllReports: '/api/reports (GET)',
      submitReport: '/api/reports (POST)',
      updateReport: '/api/reports/:id (PUT)',
      deleteReport: '/api/reports/:id (DELETE)'
    },
    timestamp: new Date().toISOString()
  });
});

// ✅ HEALTH CHECK ROUTE - Add this!
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    server: 'running',
    timestamp: new Date().toISOString()
  });
});

// API Routes

// Get all reports (for admin)
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
    
    // Basic validation
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

// Update report status (for admin)
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

// Delete report (for admin)
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌐 Health: http://0.0.0.0:${PORT}/health`);
});