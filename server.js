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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Accept', 'User-Data'],
  exposedHeaders: ['Authorization']
}));

// Handle preflight requests
app.options('*', cors());

// Body parser middleware
app.use(express.json({ limit: '50mb' }));

// =============================================
// ENHANCED USER ROLE SYSTEM WITH SECURITY
// =============================================

// User roles: 0 = regular user, 1 = editor, 2 = admin
const USER_ROLES = {
  USER: 0,
  EDITOR: 1,
  ADMIN: 2
};

// Cache for user roles to reduce database queries (optional, can remove if not needed)
const userRoleCache = new Map();

// Enhanced middleware to validate AND VERIFY user data from frontend
const validateAndVerifyUser = async (req, res, next) => {
  const userData = req.body.userData || req.headers['user-data'];
  
  if (!userData) {
    return res.status(401).json({ error: 'User authentication required' });
  }
  
  try {
    const frontendUser = typeof userData === 'string' ? JSON.parse(userData) : userData;
    
    // Validate required fields
    if (!frontendUser.id || !frontendUser.email || !frontendUser.name) {
      return res.status(400).json({ error: 'User data must contain id, email, and name' });
    }
    
    // VERIFY USER ROLE FROM DATABASE (CRITICAL SECURITY FIX)
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const dbUser = await users.findOne({ 
      $or: [
        { id: frontendUser.id },
        { email: frontendUser.email.toLowerCase() }
      ]
    });
    
    if (!dbUser) {
      return res.status(401).json({ error: 'User not found in database' });
    }
    
    if (!dbUser.isActive) {
      return res.status(403).json({ error: 'User account is deactivated' });
    }
    
    // USE DATABASE ROLE, NOT FRONTEND PROVIDED ROLE (SECURITY FIX)
    const verifiedUser = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      photo: dbUser.photo || frontendUser.photo,
      role: dbUser.role, // Always use database role
      isActive: dbUser.isActive,
      lastLogin: dbUser.lastLogin
    };
    
    // Update cache
    userRoleCache.set(verifiedUser.id, verifiedUser.role);
    
    req.user = verifiedUser;
    next();
  } catch (error) {
    console.error('Error verifying user:', error);
    return res.status(401).json({ error: 'Invalid user authentication' });
  }
};

// Lightweight validation for public endpoints that optionally use user data
const validateUserDataOptional = async (req, res, next) => {
  const userData = req.body.userData || req.headers['user-data'];
  
  if (!userData) {
    return next(); // Continue without user
  }
  
  try {
    const frontendUser = typeof userData === 'string' ? JSON.parse(userData) : userData;
    
    if (!frontendUser.id || !frontendUser.email) {
      return next(); // Invalid but optional, so continue
    }
    
    // Verify with database for accurate role
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const dbUser = await users.findOne({ 
      $or: [
        { id: frontendUser.id },
        { email: frontendUser.email.toLowerCase() }
      ]
    });
    
    if (dbUser && dbUser.isActive) {
      req.user = {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        photo: dbUser.photo,
        role: dbUser.role, // Use database role
        isActive: dbUser.isActive
      };
    }
    
    next();
  } catch (error) {
    console.log('Optional user validation failed, continuing anonymously');
    next(); // Continue without user
  }
};

// Middleware to check user role (uses verified database role)
const requireRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (req.user.role < minRole) {
      return res.status(403).json({ 
        error: `Insufficient permissions. Required role: ${minRole}, your role: ${req.user.role}`,
        requiredRole: minRole,
        userRole: req.user.role
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
    
    // Create indexes for better performance
    const database = client.db(DB_NAME);
    await database.collection(USERS_COLLECTION).createIndex({ id: 1 }, { unique: true });
    await database.collection(USERS_COLLECTION).createIndex({ email: 1 }, { unique: true });
    await database.collection(REPORTS_COLLECTION).createIndex({ userId: 1 });
    await database.collection(REPORTS_COLLECTION).createIndex({ status: 1 });
    await database.collection(POSTS_COLLECTION).createIndex({ status: 1 });
    await database.collection(POSTS_COLLECTION).createIndex({ authorId: 1 });
    
    console.log("Database indexes created");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB", error);
    process.exit(1);
  }
}

connectToDatabase();

// =============================================
// SECURE USER MANAGEMENT ROUTES
// =============================================

app.post('/api/users/sync', async (req, res) => {
  try {
    const userData = req.body.userData || req.body; // Support both nested and direct
    console.log('Syncing user:', userData.email);
    
    if (!userData || !userData.id || !userData.email || !userData.name) {
      return res.status(400).json({ error: 'User data must contain id, email, and name' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const { id, email, name, photo } = userData;
    
    // Check if user already exists
    const existingUser = await users.findOne({ 
      $or: [
        { id: id },
        { email: email.toLowerCase() }
      ]
    });
    
    let user;
    let isNewUser = false;
    
    if (existingUser) {
      // ✅ CRITICAL FIX: PRESERVE EXISTING ROLE, don't overwrite it
      const updateData = {
        name: name,
        email: email.toLowerCase(),
        photo: photo || existingUser.photo,
        lastLogin: new Date(),
        updatedAt: new Date()
      };
      
      // ✅ NEVER overwrite existing role from frontend data
      // The role stays as whatever is in the database
      
      await users.updateOne(
        { id: id },
        { 
          $set: updateData
        }
      );
      
      user = await users.findOne({ id: id });
      console.log('✅ Updated existing user:', email, 'Role:', user.role);
    } else {
      // Create new user - SET DEFAULT USER ROLE FOR SECURITY
      const newUser = {
        id: id,
        email: email.toLowerCase(),
        name: name,
        photo: photo || '',
        role: USER_ROLES.USER, // Always default to user role for new users
        isActive: true,
        createdAt: new Date(),
        lastLogin: new Date()
      };
      
      const result = await users.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
      isNewUser = true;
      console.log('✅ Created new user:', email, 'with default user role');
    }
    
    // Update cache
    userRoleCache.set(user.id, user.role);
    
    // Return ACTUAL DATABASE ROLE to frontend (critical fix)
    res.json({
      message: isNewUser ? 'User created successfully' : 'User synced successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role, // ACTUAL DATABASE ROLE
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
    
  } catch (error) {
    console.error('Error syncing user:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// Get user by ID with verified data
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
        role: user.role, // Actual database role
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

// Verify user role endpoint - for frontend to check against localStorage
app.post('/api/users/verify-role', validateAndVerifyUser, async (req, res) => {
  try {
    res.json({
      verified: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role, // Verified database role
        photo: req.user.photo
      }
    });
  } catch (error) {
    console.error('Error verifying user role:', error);
    res.status(500).json({ error: 'Failed to verify user role' });
  }
});

// Get all users (admin only)
app.get('/api/users', validateAndVerifyUser, requireRole(USER_ROLES.ADMIN), async (req, res) => {
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
app.put('/api/users/:userId/role', validateAndVerifyUser, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (role === undefined || ![USER_ROLES.USER, USER_ROLES.EDITOR, USER_ROLES.ADMIN].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Prevent self-demotion
    if (userId === req.user.id && role < USER_ROLES.ADMIN) {
      return res.status(400).json({ error: 'Cannot demote yourself from admin role' });
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

    // Update cache
    userRoleCache.set(userId, role);

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
// SECURE REPORTS API ROUTES
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

// Submit new report (with verified user data when available)
app.post('/api/reports', validateUserDataOptional, async (req, res) => {
  try {
    const { type, location, coordinates, description, severity, email, phone } = req.body;
    
    if (!type || !location || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    
    // Use verified user info if available
    let userInfo = {};
    if (req.user) {
      userInfo = {
        userId: req.user.id,
        userEmail: req.user.email,
        userName: req.user.name
      };
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

// Get user's own reports (with verified user)
app.get('/api/my-reports', validateAndVerifyUser, async (req, res) => {
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

// Update report status (editor and admin only) - USES VERIFIED ROLE
app.put('/api/reports/:id', validateAndVerifyUser, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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

// Delete report (admin only) - USES VERIFIED ROLE
app.delete('/api/reports/:id', validateAndVerifyUser, requireRole(USER_ROLES.ADMIN), async (req, res) => {
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
// SECURE COORDINATES API ROUTES
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

// Submit new coordinates (with verified user when available)
app.post('/api/coordinates', validateUserDataOptional, async (req, res) => {
  try {
    const { name, lat, lng, transparency, temperature, conductivity, waterlevel, pathogens, description } = req.body;
    
    if (!name || !lat || !lng) {
      return res.status(400).json({ error: 'Missing required fields: name, lat, lng' });
    }

    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);
    
    // Use verified user info if available
    let userInfo = {};
    if (req.user) {
      userInfo = {
        userId: req.user.id,
        userEmail: req.user.email,
        userName: req.user.name
      };
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
// SECURE POSTS API ROUTES
// =============================================

// Get all posts (editor and admin only) - USES VERIFIED ROLE
app.get('/api/posts', validateAndVerifyUser, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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

// Create new post (editor and admin only) - USES VERIFIED ROLE
app.post('/api/posts', validateAndVerifyUser, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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
      status: req.user.role === USER_ROLES.ADMIN ? 'approved' : 'pending', // Use verified role
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

// Update post status (editor and admin only) - USES VERIFIED ROLE
app.put('/api/posts/:id/status', validateAndVerifyUser, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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

// Get dashboard stats (admin only) - USES VERIFIED ROLE
app.get('/api/admin/stats', validateAndVerifyUser, requireRole(USER_ROLES.ADMIN), async (req, res) => {
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
      auth: 'Secure user role system (0=user, 1=editor, 2=admin)',
      security: 'Database-verified roles',
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
    version: '1.1.0', // Version bump for security fixes
    database: 'MongoDB Atlas',
    auth: 'Secure User Role System with Database Verification',
    security: 'All roles verified against database',
    user_roles: {
      '0': 'Regular User',
      '1': 'Editor',
      '2': 'Admin'
    },
    timestamp: new Date().toISOString(),
    endpoints: {
      users: [
        'POST /api/users/sync (returns actual database role)',
        'GET  /api/users/:userId',
        'POST /api/users/verify-role (security endpoint)',
        'GET  /api/users (admin only)',
        'PUT  /api/users/:userId/role (admin only)'
      ],
      reports: [
        'GET  /api/reports (public)',
        'POST /api/reports (uses verified user when available)',
        'GET  /api/my-reports (verified user required)',
        'PUT  /api/reports/:id (verified editor+ only)',
        'DELETE /api/reports/:id (verified admin only)'
      ],
      coordinates: [
        'GET  /api/coordinates (public)',
        'POST /api/coordinates (uses verified user when available)'
      ],
      posts: [
        'GET  /api/posts/feed (public)',
        'GET  /api/posts (verified editor+ only)',
        'POST /api/posts (verified editor+ only)',
        'PUT  /api/posts/:id/status (verified editor+ only)'
      ],
      admin: [
        'GET  /api/admin/stats (verified admin only)'
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
  console.log(`👤 SECURE User Role System: 0=User, 1=Editor, 2=Admin`);
  console.log(`🔒 Security: Database-verified roles enabled`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${DB_NAME}`);
  console.log(`🔑 User sync: POST http://0.0.0.0:${PORT}/api/users/sync`);
  console.log(`🔐 Role verification: POST http://0.0.0.0:${PORT}/api/users/verify-role`);
  console.log(`📋 Public reports: GET http://0.0.0.0:${PORT}/api/reports`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
});