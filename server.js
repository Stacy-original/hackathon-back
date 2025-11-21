const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Atlas connection string - replace with your actual credentials
const MONGODB_URI = "mongodb+srv://kasyak-render:kasyak-database-password@hackathon-data.uo8k8xi.mongodb.net/?appName=hackathon-data";

// Create a MongoClient with Stable API configuration
const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Database and Collection Names
const DB_NAME = 'skogeohydro';
const REPORTS_COLLECTION = 'reports';
const COORDINATES_COLLECTION = 'coordinates';

// Connect to MongoDB once when the server starts
async function connectToDatabase() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!");
    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. Connection is stable.");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB", error);
    process.exit(1); // Stop the server if connection fails
  }
}

// Call the connection function
connectToDatabase();

// REPORTS API ROUTES

// Get all reports
app.get('/api/reports', async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    const allReports = await reports.find({}).sort({ createdAt: -1 }).toArray();
    res.json(allReports);
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

    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    
    const newReport = {
      type,
      location,
      coordinates: coordinates || '',
      description,
      severity: severity || 'medium',
      email: email || '',
      phone: phone || '',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await reports.insertOne(newReport);
    newReport._id = result.insertedId;

    res.status(201).json({ 
      message: 'Report submitted successfully',
      report: newReport 
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

    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);

    const result = await reports.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status: status,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ message: 'Report updated successfully' });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Delete report
app.delete('/api/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);

    const result = await reports.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// COORDINATES API ROUTES

// Get all coordinates
app.get('/api/coordinates', async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);
    const allCoordinates = await coordinates.find({}).sort({ createdAt: -1 }).toArray();
    res.json(allCoordinates);
  } catch (error) {
    console.error('Error fetching coordinates:', error);
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

    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);
    
    const newCoordinate = {
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
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await coordinates.insertOne(newCoordinate);
    newCoordinate._id = result.insertedId;

    res.status(201).json({ 
      message: 'Coordinates submitted successfully',
      coordinate: newCoordinate 
    });
  } catch (error) {
    console.error('Error submitting coordinates:', error);
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

    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);

    const result = await coordinates.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status: status,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Coordinate not found' });
    }

    res.json({ 
      message: 'Coordinate updated successfully'
    });
  } catch (error) {
    console.error('Error updating coordinate:', error);
    res.status(500).json({ error: 'Failed to update coordinate' });
  }
});

// Delete coordinate
app.delete('/api/coordinates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);

    const result = await coordinates.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Coordinate not found' });
    }

    res.json({ message: 'Coordinate deleted successfully' });
  } catch (error) {
    console.error('Error deleting coordinate:', error);
    res.status(500).json({ error: 'Failed to delete coordinate' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await client.db("admin").command({ ping: 1 });
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'Connected to MongoDB Atlas'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'Database Error', 
      timestamp: new Date().toISOString(),
      database: 'Disconnected'
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'SKO GeoHydro Portal API',
    version: '1.0.0',
    database: 'MongoDB Atlas',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📁 Connected to MongoDB Atlas: hackathon-data.uo8k8xi.mongodb.net`);
  console.log(`🌐 Health check: http://0.0.0.0:${PORT}/health`);
});