const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================
// MIDDLEWARE CONFIGURATION
// =============================================

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://hackathon-one-blue.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      console.log('CORS blocked for origin:', origin);
      return callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Accept'],
  exposedHeaders: ['Authorization']
}));

// Handle preflight requests
app.options('*', cors());

// Body parser middleware
app.use(express.json({ limit: '50mb' }));

// =============================================
// SIMPLE USER ROLE SYSTEM
// =============================================

// User roles: 0 = regular user, 1 = editor, 2 = admin
const USER_ROLES = {
  USER: 0,
  EDITOR: 1,
  ADMIN: 2
};

// Middleware to validate user data from frontend
const validateUserData = (req, res, next) => {
  const userData = req.body.userData || req.headers['user-data'];
  
  if (!userData) {
    return res.status(400).json({ error: 'User data required' });
  }
  
  try {
    const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
    
    // Validate required fields
    if (!user.id || !user.email || !user.name) {
      return res.status(400).json({ error: 'User data must contain id, email, and name' });
    }
    
    // Set default role if not provided
    if (user.role === undefined) {
      user.role = USER_ROLES.USER;
    }
    
    // Validate role
    if (![USER_ROLES.USER, USER_ROLES.EDITOR, USER_ROLES.ADMIN].includes(user.role)) {
      return res.status(400).json({ error: 'Invalid user role' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Error parsing user data:', error);
    return res.status(400).json({ error: 'Invalid user data format' });
  }
};

// Middleware to check user role
const requireRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User data required' });
    }
    
    if (req.user.role < minRole) {
      return res.status(403).json({ 
        error: `Insufficient permissions. Required role: ${minRole}, your role: ${req.user.role}` 
      });
    }
    
    next();
  };
};

// =============================================
// MONGODB CONFIGURATION
// =============================================

const MONGODB_URI = "mongodb+srv://kasyak-render:kasyak-database-password@hackathon-data.uo8k8xi.mongodb.net/?appName=hackathon-data";

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
const POSTS_COLLECTION = 'posts';
const USERS_COLLECTION = 'users';

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!");
    
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. Connection is stable.");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB", error);
    process.exit(1);
  }
}

connectToDatabase();

// =============================================
// USER MANAGEMENT ROUTES
// =============================================

// Create or update user from frontend data
app.post('/api/users/sync', validateUserData, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const { id, email, name, photo, role = USER_ROLES.USER } = req.user;
    
    // Check if user already exists
    const existingUser = await users.findOne({ 
      $or: [
        { id: id },
        { email: email.toLowerCase() }
      ]
    });
    
    let user;
    
    if (existingUser) {
      // Update existing user
      await users.updateOne(
        { id: id },
        { 
          $set: { 
            name: name,
            email: email.toLowerCase(),
            photo: photo,
            lastLogin: new Date(),
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
      
      user = await users.findOne({ id: id });
      console.log('Updated existing user:', email);
    } else {
      // Create new user
      const newUser = {
        id: id,
        email: email.toLowerCase(),
        name: name,
        photo: photo || '',
        role: role,
        isActive: true,
        createdAt: new Date(),
        lastLogin: new Date()
      };
      
      const result = await users.insertOne(newUser);
      newUser._id = result.insertedId;
      user = newUser;
      console.log('Created new user:', email);
    }
    
    res.json({
      message: 'User synced successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    });
    
  } catch (error) {
    console.error('Error syncing user:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// Get user by ID
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const user = await users.findOne({ id: userId });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get all users (admin only)
app.get('/api/users', validateUserData, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    const allUsers = await users.find({}).sort({ createdAt: -1 }).toArray();
    
    const safeUsers = allUsers.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      photo: user.photo,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    }));
    
    res.json(safeUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user role (admin only)
app.put('/api/users/:userId/role', validateUserData, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (role === undefined || ![USER_ROLES.USER, USER_ROLES.EDITOR, USER_ROLES.ADMIN].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);

    const result = await users.updateOne(
      { id: userId },
      { $set: { role: role, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      message: 'User role updated successfully',
      userId: userId,
      newRole: role
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// =============================================
// REPORTS API ROUTES
// =============================================

// Get all reports (public)
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

// Submit new report (supports both authenticated and anonymous users)
app.post('/api/reports', async (req, res) => {
  try {
    const { type, location, coordinates, description, severity, email, phone, userData } = req.body;
    
    if (!type || !location || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    
    // Extract user info if provided
    let userInfo = {};
    if (userData) {
      try {
        const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
        userInfo = {
          userId: user.id,
          userEmail: user.email,
          userName: user.name
        };
      } catch (error) {
        console.log('Invalid user data, submitting as anonymous');
      }
    }
    
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
      updatedAt: new Date(),
      ...userInfo
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

// Get user's own reports
app.get('/api/my-reports', validateUserData, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    const userReports = await reports.find({ 
      userId: req.user.id
    }).sort({ createdAt: -1 }).toArray();
    
    res.json(userReports);
  } catch (error) {
    console.error('Error fetching user reports:', error);
    res.status(500).json({ error: 'Failed to fetch user reports' });
  }
});

// Update report status (editor and admin only)
app.put('/api/reports/:id', validateUserData, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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
          updatedAt: new Date(),
          updatedBy: req.user.id
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

// Delete report (admin only)
app.delete('/api/reports/:id', validateUserData, requireRole(USER_ROLES.ADMIN), async (req, res) => {
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

// =============================================
// COORDINATES API ROUTES
// =============================================

// Get all coordinates (public)
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
    const { name, lat, lng, transparency, temperature, conductivity, waterlevel, pathogens, description, userData } = req.body;
    
    if (!name || !lat || !lng) {
      return res.status(400).json({ error: 'Missing required fields: name, lat, lng' });
    }

    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);
    
    // Extract user info if provided
    let userInfo = {};
    if (userData) {
      try {
        const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
        userInfo = {
          userId: user.id,
          userEmail: user.email,
          userName: user.name
        };
      } catch (error) {
        console.log('Invalid user data, submitting as anonymous');
      }
    }
    
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
      updatedAt: new Date(),
      ...userInfo
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

// =============================================
// POSTS API ROUTES
// =============================================

// Get all posts (editor and admin only)
app.get('/api/posts', validateUserData, requireRole(USER_ROLES.EDITOR), async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);
    const allPosts = await posts.find({}).sort({ createdAt: -1 }).toArray();
    res.json(allPosts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Get approved posts for feed (public)
app.get('/api/posts/feed', async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);
    const approvedPosts = await posts.find({ status: 'approved' }).sort({ createdAt: -1 }).toArray();
    res.json(approvedPosts);
  } catch (error) {
    console.error('Error fetching feed posts:', error);
    res.status(500).json({ error: 'Failed to fetch feed posts' });
  }
});

// Create new post (editor and admin only)
app.post('/api/posts', validateUserData, requireRole(USER_ROLES.EDITOR), async (req, res) => {
  try {
    const { title, content, image, category } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);
    
    const newPost = {
      title,
      content,
      image: image || '',
      category: category || 'general',
      status: req.user.role === USER_ROLES.ADMIN ? 'approved' : 'pending',
      authorId: req.user.id,
      authorName: req.user.name,
      authorEmail: req.user.email,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await posts.insertOne(newPost);
    newPost._id = result.insertedId;

    res.status(201).json({ 
      message: 'Post created successfully',
      post: newPost 
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Update post status (editor and admin only)
app.put('/api/posts/:id/status', validateUserData, requireRole(USER_ROLES.EDITOR), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);

    const result = await posts.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status: status,
          updatedAt: new Date(),
          reviewedBy: req.user.id
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ message: 'Post status updated successfully' });
  } catch (error) {
    console.error('Error updating post status:', error);
    res.status(500).json({ error: 'Failed to update post status' });
  }
});

// =============================================
// ADMIN DASHBOARD ROUTES
// =============================================

// Get dashboard stats (admin only)
app.get('/api/admin/stats', validateUserData, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    
    const usersCount = await database.collection(USERS_COLLECTION).countDocuments();
    const reportsCount = await database.collection(REPORTS_COLLECTION).countDocuments();
    const coordinatesCount = await database.collection(COORDINATES_COLLECTION).countDocuments();
    const postsCount = await database.collection(POSTS_COLLECTION).countDocuments();
    
    const pendingReports = await database.collection(REPORTS_COLLECTION).countDocuments({ status: 'pending' });
    const pendingPosts = await database.collection(POSTS_COLLECTION).countDocuments({ status: 'pending' });
    
    res.json({
      users: usersCount,
      reports: reportsCount,
      coordinates: coordinatesCount,
      posts: postsCount,
      pendingReports: pendingReports,
      pendingPosts: pendingPosts,
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// =============================================
// HEALTH CHECK AND ROOT ROUTES
// =============================================

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await client.db("admin").command({ ping: 1 });
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'Connected to MongoDB Atlas',
      auth: 'Simple user role system (0=user, 1=editor, 2=admin)',
      environment: process.env.NODE_ENV || 'development'
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

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'SKO GeoHydro Portal API',
    version: '1.0.0',
    database: 'MongoDB Atlas',
    auth: 'Simple User Role System',
    user_roles: {
      '0': 'Regular User',
      '1': 'Editor',
      '2': 'Admin'
    },
    timestamp: new Date().toISOString(),
    endpoints: {
      users: [
        'POST /api/users/sync (send userData in body)',
        'GET  /api/users/:userId',
        'GET  /api/users (admin only)',
        'PUT  /api/users/:userId/role (admin only)'
      ],
      reports: [
        'GET  /api/reports (public)',
        'POST /api/reports (include userData for authenticated)',
        'GET  /api/my-reports (send userData)',
        'PUT  /api/reports/:id (editor+ only)',
        'DELETE /api/reports/:id (admin only)'
      ],
      coordinates: [
        'GET  /api/coordinates (public)',
        'POST /api/coordinates (include userData for authenticated)'
      ],
      posts: [
        'GET  /api/posts/feed (public)',
        'GET  /api/posts (editor+ only)',
        'POST /api/posts (editor+ only)',
        'PUT  /api/posts/:id/status (editor+ only)'
      ],
      admin: [
        'GET  /api/admin/stats (admin only)'
      ]
    }
  });
});

// =============================================
// ERROR HANDLING AND GRACEFUL SHUTDOWN
// =============================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Connected to MongoDB Atlas: hackathon-data.uo8k8xi.mongodb.net`);
  console.log(`👤 User Role System: 0=User, 1=Editor, 2=Admin`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${DB_NAME}`);
  console.log(`🔑 User sync: POST http://0.0.0.0:${PORT}/api/users/sync`);
  console.log(`📋 Public reports: GET http://0.0.0.0:${PORT}/api/reports`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
});