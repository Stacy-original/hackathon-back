const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
let db;
let client;

const connectDB = async () => {
  try {
    // ✅ SAFE - Only use environment variable
    const uri = process.env.MONGODB_URI;
    
    client = new MongoClient(uri);
    
    await client.connect();
    
    // Database name - using 'skogeohydro'
    db = client.db('skogeohydro');
    
    console.log('✅ MongoDB Connected Successfully');
    console.log('📊 Database: skogeohydro');
    
    return db;
  } catch (error) {
    console.error('❌ Database connection error:', error);
    process.exit(1);
  }
};

// Get the database instance
const getDB = () => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB first.');
  }
  return db;
};

// API Routes

// Get all reports
app.get('/api/reports', async (req, res) => {
  try {
    const database = getDB();
    const collection = database.collection('reports');
    
    const reports = await collection.find({})
      .sort({ createdAt: -1 })
      .toArray();
    
    res.json(reports);
  } catch (error) {
    console.error('Error fetching reports:', error);
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

    const database = getDB();
    const collection = database.collection('reports');
    
    const newReport = {
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

    const result = await collection.insertOne(newReport);
    
    // Add the generated MongoDB ID to the response
    const savedReport = {
      ...newReport,
      _id: result.insertedId
    };

    res.status(201).json({ 
      message: 'Report submitted successfully',
      report: savedReport 
    });
  } catch (error) {
    console.error('Error submitting report:', error);
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

    const database = getDB();
    const collection = database.collection('reports');
    
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status: status,
          updatedAt: new Date().toISOString()
        } 
      },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ 
      message: 'Report updated successfully',
      report: result.value
    });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Delete report
app.delete('/api/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = getDB();
    const collection = database.collection('reports');
    
    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Health check with database connection test
app.get('/health', async (req, res) => {
  try {
    const database = getDB();
    // Test the connection
    await database.command({ ping: 1 });
    
    res.json({ 
      status: 'OK', 
      database: 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'Disconnected',
      error: error.message 
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'SKO GeoHydro Portal API',
    version: '1.0.0',
    database: 'MongoDB',
    timestamp: new Date().toISOString()
  });
});

// Connect to database and start server
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📊 Database: MongoDB Atlas`);
    console.log(`🌐 Health check: http://0.0.0.0:${PORT}/health`);
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
});