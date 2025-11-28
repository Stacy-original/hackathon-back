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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Accept', 'User-Data', 'X-API-Key'],
  exposedHeaders: ['Authorization']
}));

// Handle preflight requests
app.options('*', cors());

// Body parser middleware
app.use(express.json({ limit: '50mb' }));

// UTF-8 encoding middleware - ADDED
app.use((req, res, next) => {
  // Set proper content type for responses
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Helper function to fix encoding for existing data - ADDED
function fixCyrillicEncoding(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Check if it looks like misencoded Cyrillic (contains common mojibake patterns)
  const cyrillicMojibakePattern = /Ð|Ñ|Ò|Ó|Ô|Õ|Ö|×|Ø|Ù/;
  if (cyrillicMojibakePattern.test(text)) {
    try {
      // Fix the encoding by converting from Latin-1 to UTF-8
      return Buffer.from(text, 'binary').toString('utf-8');
    } catch (e) {
      console.warn('Failed to fix encoding for:', text);
      return text;
    }
  }
  return text;
}

// =============================================
// API KEY SECURITY SYSTEM
// =============================================

const API_KEYS = {
  USER: process.env.USER_API_KEY || 'user_key_123',
  EDITOR: process.env.EDITOR_API_KEY || 'editor_key_123',
  ADMIN: process.env.ADMIN_API_KEY || 'admin_key_123'
};

// API Key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  // Check if API key is valid
  const keyType = Object.keys(API_KEYS).find(key => API_KEYS[key] === apiKey);
  
  if (!keyType) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.apiKeyType = keyType;
  req.userRole = getRoleFromApiKey(keyType);
  next();
};

// Get role from API key type
const getRoleFromApiKey = (keyType) => {
  const roles = {
    'USER': 0,
    'EDITOR': 1, 
    'ADMIN': 2
  };
  return roles[keyType] || 0;
};

// Middleware to require minimum role
const requireRole = (minRole) => {
  return (req, res, next) => {
    if (req.userRole < minRole) {
      return res.status(403).json({ 
        error: `Insufficient permissions. Required role: ${minRole}, your role: ${req.userRole}`,
        requiredRole: minRole,
        userRole: req.userRole
      });
    }
    next();
  };
};

// Optional API key validation for public endpoints
const validateApiKeyOptional = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey) {
    const keyType = Object.keys(API_KEYS).find(key => API_KEYS[key] === apiKey);
    if (keyType) {
      req.apiKeyType = keyType;
      req.userRole = getRoleFromApiKey(keyType);
    }
  }
  
  next();
};

// =============================================
// USER ROLES AND POINTS SYSTEM
// =============================================

const USER_ROLES = {
  USER: 0,
  EDITOR: 1,
  ADMIN: 2
};

const POINTS_SYSTEM = {
  POST: 5,
  COORDINATE: 3,
  REPORT: 2,
  COMMENT: 1,
  LIKE_RECEIVED: 1
};

// =============================================
// MONGODB CONFIGURATION
// =============================================

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://kasyak-render:kasyak-database-password@hackathon-data.uo8k8xi.mongodb.net/?appName=hackathon-data";

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
const COMMENTS_COLLECTION = 'comments';
const LIKES_COLLECTION = 'likes';

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!");
    
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. Connection is stable.");
    
    // ✅ TEMPORARY: Skip index creation to avoid deployment issues
    console.log("⚠️ Index creation skipped - server running without indexes");
    
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB", error);
    process.exit(1);
  }
}

connectToDatabase();

// =============================================
// USER SYNC AND VERIFICATION ENDPOINTS
// =============================================

// Sync user with backend (for login)
app.post('/api/users/sync', validateApiKey, async (req, res) => {
  try {
    const { userData } = req.body;
    
    if (!userData || !userData.id || !userData.email) {
      return res.status(400).json({ error: 'Invalid user data' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');

    // Check if user exists
    let user = await users.findOne({ 
      $or: [{ id: userData.id }, { email: userData.email }] 
    });

    if (user) {
      // Update last login
      await users.updateOne(
        { id: userData.id },
        { 
          $set: { 
            lastLogin: new Date(),
            lastActivity: new Date(),
            updatedAt: new Date()
          } 
        }
      );
      
      // Get updated user
      user = await users.findOne({ id: userData.id });
    } else {
      // Create new user
      const newUser = {
        id: userData.id,
        name: fixCyrillicEncoding(userData.name), // FIXED ENCODING
        email: userData.email,
        photo: userData.photo || '',
        role: USER_ROLES.USER, // Default role
        points: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: new Date(),
        lastActivity: new Date(),
        pointsHistory: []
      };

      await users.insertOne(newUser);
      user = newUser;
    }

    // Return safe user data
    res.json({
      message: 'User synced successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role,
        points: user.points || 0,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity
      }
    });
  } catch (error) {
    console.error('Error syncing user:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// Verify user role
app.post('/api/users/verify-role', validateApiKey, async (req, res) => {
  try {
    const { userData } = req.body;
    
    if (!userData || !userData.id) {
      return res.status(400).json({ error: 'Invalid user data' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');

    const user = await users.findOne({ id: userData.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update last activity
    await users.updateOne(
      { id: userData.id },
      { 
        $set: { 
          lastActivity: new Date(),
          updatedAt: new Date()
        } 
      }
    );

    res.json({
      message: 'Role verified',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role,
        points: user.points || 0,
        isActive: user.isActive,
        lastActivity: user.lastActivity
      }
    });
  } catch (error) {
    console.error('Error verifying role:', error);
    res.status(500).json({ error: 'Failed to verify role' });
  }
});

// =============================================
// USER MANAGEMENT ROUTES
// =============================================

// Create new user (public - for registration)
app.post('/api/users', validateApiKey, async (req, res) => {
  try {
    const { id, name, email, photo, role = USER_ROLES.USER } = req.body;
    
    if (!id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: id, name, email' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
    // Check if user already exists
    const existingUser = await users.findOne({ 
      $or: [{ id: id }, { email: email }] 
    });
    
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const newUser = {
      id,
      name: fixCyrillicEncoding(name), // FIXED ENCODING
      email,
      photo: photo || '',
      role: role,
      points: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: new Date(),
      lastActivity: new Date(),
      pointsHistory: []
    };

    await users.insertOne(newUser);

    // Return user without sensitive data
    const safeUser = {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      photo: newUser.photo,
      role: newUser.role,
      points: newUser.points,
      isActive: newUser.isActive,
      createdAt: newUser.createdAt,
      lastLogin: newUser.lastLogin
    };

    res.status(201).json({ 
      message: 'User created successfully',
      user: safeUser
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Get user by email (for authentication)
app.get('/api/users/email/:email', validateApiKey, async (req, res) => {
  try {
    const { email } = req.params;
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
    const user = await users.findOne({ email: email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return safe user data
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role,
        points: user.points || 0,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity
      }
    });
  } catch (error) {
    console.error('Error fetching user by email:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update user profile (user can update their own profile)
app.put('/api/users/:userId/profile', validateApiKey, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, photo } = req.body;

    // Users can only update their own profile unless they're admin
    if (req.userRole < USER_ROLES.ADMIN && req.body.userId !== userId) {
      return res.status(403).json({ error: 'Cannot update other users profiles' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');

    const updateData = { updatedAt: new Date() };
    if (name) updateData.name = fixCyrillicEncoding(name); // FIXED ENCODING
    if (photo !== undefined) updateData.photo = photo;

    const result = await users.updateOne(
      { id: userId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get updated user
    const updatedUser = await users.findOne({ id: userId });

    res.json({ 
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        photo: updatedUser.photo,
        role: updatedUser.role,
        points: updatedUser.points,
        isActive: updatedUser.isActive,
        createdAt: updatedUser.createdAt,
        lastLogin: updatedUser.lastLogin,
        lastActivity: updatedUser.lastActivity
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update user last login time
app.put('/api/users/:userId/activity', validateApiKey, async (req, res) => {
  try {
    const { userId } = req.params;
    const { activityType = 'login' } = req.body;

    const database = client.db(DB_NAME);
    const users = database.collection('users');

    const updateData = { 
      lastActivity: new Date(),
      updatedAt: new Date()
    };

    if (activityType === 'login') {
      updateData.lastLogin = new Date();
    }

    await users.updateOne(
      { id: userId },
      { $set: updateData }
    );

    res.json({ message: 'User activity updated' });
  } catch (error) {
    console.error('Error updating user activity:', error);
    res.status(500).json({ error: 'Failed to update activity' });
  }
});

// Get current user profile
app.get('/api/users/me', validateApiKey, async (req, res) => {
  try {
    // This would typically get user ID from JWT token or session
    // For now, we'll require userId in query params
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
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
        points: user.points || 0,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity,
        pointsHistory: user.pointsHistory || []
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// =============================================
// SECURE USER MANAGEMENT ROUTES (ADMIN ONLY)
// =============================================

// Get all users (admin only)
app.get('/api/users', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    const allUsers = await users.find({}).sort({ createdAt: -1 }).toArray();
    
    const safeUsers = allUsers.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      photo: user.photo,
      role: user.role,
      points: user.points || 0,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      lastActivity: user.lastActivity
    }));
    
    res.json(safeUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by ID (admin only)
app.get('/api/users/:userId', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { userId } = req.params;
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
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
        points: user.points || 0,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity,
        pointsHistory: user.pointsHistory || []
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update user role (admin only)
app.put('/api/users/:userId/role', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (role === undefined || ![USER_ROLES.USER, USER_ROLES.EDITOR, USER_ROLES.ADMIN].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');

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

// Update user status (admin only)
app.put('/api/users/:userId/status', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection('users');

    const result = await users.updateOne(
      { id: userId },
      { $set: { isActive: isActive, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      userId: userId,
      isActive: isActive
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Delete user (admin only)
app.delete('/api/users/:userId', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { userId } = req.params;
    const database = client.db(DB_NAME);
    const users = database.collection('users');

    const result = await users.deleteOne({ id: userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get user statistics (admin only)
app.get('/api/users/stats/overview', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
    const totalUsers = await users.countDocuments();
    const activeUsers = await users.countDocuments({ isActive: true });
    const adminUsers = await users.countDocuments({ role: USER_ROLES.ADMIN });
    const editorUsers = await users.countDocuments({ role: USER_ROLES.EDITOR });
    const regularUsers = await users.countDocuments({ role: USER_ROLES.USER });
    
    // Get top users by points
    const topUsers = await users.find({ points: { $exists: true, $gt: 0 } })
      .sort({ points: -1 })
      .limit(5)
      .project({ name: 1, email: 1, points: 1, lastActivity: 1 })
      .toArray();

    res.json({
      totalUsers,
      activeUsers,
      roleDistribution: {
        admin: adminUsers,
        editor: editorUsers,
        user: regularUsers
      },
      topUsers,
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
});

// =============================================
// POINTS MANAGEMENT FUNCTIONS
// =============================================

// Award points to user
async function awardPoints(userId, pointsType, itemId) {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
    const points = POINTS_SYSTEM[pointsType];
    if (!points) return;

    await users.updateOne(
      { id: userId },
      { 
        $inc: { points: points },
        $set: { lastActivity: new Date() },
        $push: { 
          pointsHistory: {
            type: pointsType,
            points: points,
            itemId: itemId,
            date: new Date()
          }
        }
      }
    );
    
    console.log(`Awarded ${points} points to user ${userId} for ${pointsType}`);
  } catch (error) {
    console.error('Error awarding points:', error);
  }
}

// Award points for likes received
async function awardLikePoints(contentOwnerId, contentId) {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
    await users.updateOne(
      { id: contentOwnerId },
      { 
        $inc: { points: POINTS_SYSTEM.LIKE_RECEIVED },
        $set: { lastActivity: new Date() },
        $push: { 
          pointsHistory: {
            type: 'LIKE_RECEIVED',
            points: POINTS_SYSTEM.LIKE_RECEIVED,
            contentId: contentId,
            date: new Date()
          }
        }
      }
    );
  } catch (error) {
    console.error('Error awarding like points:', error);
  }
}

// =============================================
// SECURE REPORTS API ROUTES
// =============================================

// Get all reports (public - requires API key)
app.get('/api/reports', validateApiKey, async (req, res) => {
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

// Submit new report (requires API key)
app.post('/api/reports', validateApiKey, async (req, res) => {
  try {
    const { type, location, coordinates, description, severity, email, phone, userId, userName, userEmail } = req.body;
    
    if (!type || !location || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    
    const newReport = {
      type,
      location: fixCyrillicEncoding(location), // FIXED ENCODING
      coordinates: coordinates || '',
      description: fixCyrillicEncoding(description), // FIXED ENCODING
      severity: severity || 'medium',
      email: email || '',
      phone: phone || '',
      status: 'pending',
      userId: userId || '',
      userName: fixCyrillicEncoding(userName || ''), // FIXED ENCODING
      userEmail: userEmail || '',
      likes: 0,
      dislikes: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await reports.insertOne(newReport);
    newReport._id = result.insertedId;

    // Award points if user provided
    if (userId) {
      await awardPoints(userId, 'REPORT', newReport._id.toString());
    }

    res.status(201).json({ 
      message: 'Report submitted successfully',
      report: newReport 
    });
  } catch (error) {
    console.error('Error submitting report:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// Update report status (editor and admin only)
app.put('/api/reports/:id', validateApiKey, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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

// Delete report (admin only)
app.delete('/api/reports/:id', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
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

// Get all coordinates (public - requires API key)
app.get('/api/coordinates', validateApiKey, async (req, res) => {
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

// Submit new coordinates (requires API key)
app.post('/api/coordinates', validateApiKey, async (req, res) => {
  try {
    const { name, lat, lng, transparency, temperature, conductivity, waterlevel, pathogens, description, userId, userName, userEmail } = req.body;
    
    if (!name || !lat || !lng) {
      return res.status(400).json({ error: 'Missing required fields: name, lat, lng' });
    }

    const database = client.db(DB_NAME);
    const coordinates = database.collection(COORDINATES_COLLECTION);
    
    const newCoordinate = {
      name: fixCyrillicEncoding(name), // FIXED ENCODING
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      transparency: transparency ? parseFloat(transparency) : null,
      temperature: temperature ? parseFloat(temperature) : null,
      conductivity: conductivity ? parseFloat(conductivity) : null,
      waterlevel: waterlevel ? parseFloat(waterlevel) : null,
      pathogens: pathogens || 'Unknown',
      description: fixCyrillicEncoding(description || ''), // FIXED ENCODING
      status: 'pending',
      userId: userId || '',
      userName: fixCyrillicEncoding(userName || ''), // FIXED ENCODING
      userEmail: userEmail || '',
      likes: 0,
      dislikes: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await coordinates.insertOne(newCoordinate);
    newCoordinate._id = result.insertedId;

    // Award points if user provided
    if (userId) {
      await awardPoints(userId, 'COORDINATE', newCoordinate._id.toString());
    }

    res.status(201).json({ 
      message: 'Coordinates submitted successfully',
      coordinate: newCoordinate 
    });
  } catch (error) {
    console.error('Error submitting coordinates:', error);
    res.status(500).json({ error: 'Failed to submit coordinates' });
  }
});

// Update coordinate status (editor and admin only) - ADDED
app.put('/api/coordinates/:id', validateApiKey, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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

    res.json({ message: 'Coordinate updated successfully' });
  } catch (error) {
    console.error('Error updating coordinate:', error);
    res.status(500).json({ error: 'Failed to update coordinate' });
  }
});

// Delete coordinate (admin only) - ADDED
app.delete('/api/coordinates/:id', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
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

// =============================================
// SECURE POSTS API ROUTES
// =============================================

// Get all posts (editor and admin only)
app.get('/api/posts', validateApiKey, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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

// Get approved posts for feed (public - requires API key)
app.get('/api/posts/feed', validateApiKey, async (req, res) => {
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
app.post('/api/posts', validateApiKey, requireRole(USER_ROLES.EDITOR), async (req, res) => {
  try {
    const { title, content, image, category, userId, userName, userEmail } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);
    
    const newPost = {
      title: fixCyrillicEncoding(title), // FIXED ENCODING
      content: fixCyrillicEncoding(content), // FIXED ENCODING
      image: image || '',
      category: category || 'general',
      status: req.userRole === USER_ROLES.ADMIN ? 'approved' : 'pending',
      authorId: userId || '',
      authorName: fixCyrillicEncoding(userName || ''), // FIXED ENCODING
      authorEmail: userEmail || '',
      likes: 0,
      dislikes: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await posts.insertOne(newPost);
    newPost._id = result.insertedId;

    // Award points if user provided
    if (userId) {
      await awardPoints(userId, 'POST', newPost._id.toString());
    }

    res.status(201).json({ 
      message: 'Post created successfully',
      post: newPost 
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Update post status (editor and admin only) - FIXED ROUTE
app.put('/api/posts/:id', validateApiKey, requireRole(USER_ROLES.EDITOR), async (req, res) => {
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
          updatedAt: new Date()
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

// Delete post (admin only) - ADDED
app.delete('/api/posts/:id', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { id } = req.params;
    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);

    const result = await posts.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// =============================================
// COMMENTS SYSTEM ROUTES
// =============================================

// Get comments for a specific parent (public - requires API key)
app.get('/api/comments/:parentType/:parentId', validateApiKey, async (req, res) => {
  try {
    const { parentType, parentId } = req.params;
    
    const database = client.db(DB_NAME);
    const comments = database.collection(COMMENTS_COLLECTION);
    
    const allComments = await comments.find({ 
      parentType, 
      parentId 
    }).sort({ createdAt: -1 }).toArray();
    
    res.json(allComments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Create new comment (requires API key)
app.post('/api/comments', validateApiKey, async (req, res) => {
  try {
    const { parentType, parentId, content, userId, userName, userEmail } = req.body;
    
    if (!parentType || !parentId || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const database = client.db(DB_NAME);
    const comments = database.collection(COMMENTS_COLLECTION);
    
    const newComment = {
      parentType,
      parentId,
      content: fixCyrillicEncoding(content), // FIXED ENCODING
      userId: userId || '',
      userName: fixCyrillicEncoding(userName || ''), // FIXED ENCODING
      userEmail: userEmail || '',
      likes: 0,
      dislikes: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await comments.insertOne(newComment);
    newComment._id = result.insertedId;

    // Update comment count in parent document
    await updateCommentCount(parentType, parentId);

    // Award points if user provided
    if (userId) {
      await awardPoints(userId, 'COMMENT', newComment._id.toString());
    }

    res.status(201).json({ 
      message: 'Comment created successfully',
      comment: newComment 
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Update comment (requires API key and ownership)
app.put('/api/comments/:id', validateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, userId } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const database = client.db(DB_NAME);
    const comments = database.collection(COMMENTS_COLLECTION);

    // Check ownership if userId provided
    const query = { _id: new ObjectId(id) };
    if (userId) {
      query.userId = userId;
    }

    const result = await comments.updateOne(
      query,
      { 
        $set: { 
          content: fixCyrillicEncoding(content), // FIXED ENCODING
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Comment not found or not authorized' });
    }

    res.json({ message: 'Comment updated successfully' });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete comment (requires API key and ownership or admin role)
app.delete('/api/comments/:id', validateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const database = client.db(DB_NAME);
    const comments = database.collection(COMMENTS_COLLECTION);

    // Check ownership if userId provided and not admin
    const query = { _id: new ObjectId(id) };
    if (userId && req.userRole < USER_ROLES.ADMIN) {
      query.userId = userId;
    }

    const comment = await comments.findOne(query);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found or not authorized' });
    }

    const result = await comments.deleteOne({ _id: new ObjectId(id) });

    // Update comment count in parent document
    await updateCommentCount(comment.parentType, comment.parentId, -1);

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Helper function to update comment count
async function updateCommentCount(parentType, parentId, increment = 1) {
  try {
    const database = client.db(DB_NAME);
    let collection;
    
    switch (parentType) {
      case 'post':
        collection = database.collection(POSTS_COLLECTION);
        break;
      case 'report':
        collection = database.collection(REPORTS_COLLECTION);
        break;
      case 'coordinate':
        collection = database.collection(COORDINATES_COLLECTION);
        break;
      default:
        return;
    }

    await collection.updateOne(
      { _id: new ObjectId(parentId) },
      { $inc: { commentCount: increment } }
    );
  } catch (error) {
    console.error('Error updating comment count:', error);
  }
}

// =============================================
// LIKES/DISLIKES SYSTEM ROUTES
// =============================================

// Get reactions for a specific parent (public - requires API key)
app.get('/api/reactions/:parentType/:parentId', validateApiKey, async (req, res) => {
  try {
    const { parentType, parentId } = req.params;
    const { userId } = req.query;
    
    const database = client.db(DB_NAME);
    const likes = database.collection(LIKES_COLLECTION);
    
    // Get all reactions for this parent
    const reactions = await likes.find({ 
      parentType, 
      parentId 
    }).toArray();
    
    // Count likes and dislikes
    const likeCount = reactions.filter(r => r.type === 'like').length;
    const dislikeCount = reactions.filter(r => r.type === 'dislike').length;
    
    // Get user's current reaction if userId provided
    let userReaction = null;
    if (userId) {
      const userReactionDoc = await likes.findOne({ 
        parentType, 
        parentId, 
        userId 
      });
      userReaction = userReactionDoc ? userReactionDoc.type : null;
    }

    res.json({
      likes: likeCount,
      dislikes: dislikeCount,
      userReaction
    });
  } catch (error) {
    console.error('Error fetching reactions:', error);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

// Toggle reaction (like/dislike) - requires API key
app.post('/api/reactions', validateApiKey, async (req, res) => {
  try {
    const { parentType, parentId, type, userId, userName } = req.body;
    
    if (!parentType || !parentId || !type || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    const database = client.db(DB_NAME);
    const likes = database.collection(LIKES_COLLECTION);

    // Check if user already has a reaction
    const existingReaction = await likes.findOne({ 
      parentType, 
      parentId, 
      userId 
    });

    let result;
    let contentOwnerId = '';

    if (existingReaction) {
      if (existingReaction.type === type) {
        // Remove reaction if same type clicked
        await likes.deleteOne({ 
          parentType, 
          parentId, 
          userId 
        });
        result = 'removed';
      } else {
        // Update reaction if different type
        await likes.updateOne(
          { parentType, parentId, userId },
          { $set: { type: type, updatedAt: new Date() } }
        );
        result = 'updated';
        
        // Get content owner for points (only if switching from dislike to like)
        if (type === 'like') {
          contentOwnerId = await getContentOwnerId(parentType, parentId);
        }
      }
    } else {
      // Create new reaction
      await likes.insertOne({
        parentType,
        parentId,
        type,
        userId,
        userName: fixCyrillicEncoding(userName || ''), // FIXED ENCODING
        createdAt: new Date(),
        updatedAt: new Date()
      });
      result = 'added';
      
      // Get content owner for points (only for new likes)
      if (type === 'like') {
        contentOwnerId = await getContentOwnerId(parentType, parentId);
      }
    }

    // Award points to content owner for new likes
    if (contentOwnerId && contentOwnerId !== userId) {
      await awardLikePoints(contentOwnerId, parentId);
    }

    // Update like/dislike counts in parent document
    await updateReactionCounts(parentType, parentId);

    res.json({ 
      message: `Reaction ${result} successfully`,
      result 
    });
  } catch (error) {
    console.error('Error toggling reaction:', error);
    res.status(500).json({ error: 'Failed to toggle reaction' });
  }
});

// Helper function to get content owner ID
async function getContentOwnerId(parentType, parentId) {
  try {
    const database = client.db(DB_NAME);
    let collection, field;
    
    switch (parentType) {
      case 'post':
        collection = database.collection(POSTS_COLLECTION);
        field = 'authorId';
        break;
      case 'report':
        collection = database.collection(REPORTS_COLLECTION);
        field = 'userId';
        break;
      case 'coordinate':
        collection = database.collection(COORDINATES_COLLECTION);
        field = 'userId';
        break;
      case 'comment':
        collection = database.collection(COMMENTS_COLLECTION);
        field = 'userId';
        break;
      default:
        return '';
    }

    const doc = await collection.findOne({ _id: new ObjectId(parentId) });
    return doc ? doc[field] : '';
  } catch (error) {
    console.error('Error getting content owner:', error);
    return '';
  }
}

// Helper function to update reaction counts
async function updateReactionCounts(parentType, parentId) {
  try {
    const database = client.db(DB_NAME);
    const likes = database.collection(LIKES_COLLECTION);
    
    const reactions = await likes.find({ 
      parentType, 
      parentId 
    }).toArray();
    
    const likeCount = reactions.filter(r => r.type === 'like').length;
    const dislikeCount = reactions.filter(r => r.type === 'dislike').length;

    let collection;
    switch (parentType) {
      case 'post':
        collection = database.collection(POSTS_COLLECTION);
        break;
      case 'report':
        collection = database.collection(REPORTS_COLLECTION);
        break;
      case 'coordinate':
        collection = database.collection(COORDINATES_COLLECTION);
        break;
      case 'comment':
        collection = database.collection(COMMENTS_COLLECTION);
        break;
      default:
        return;
    }

    await collection.updateOne(
      { _id: new ObjectId(parentId) },
      { 
        $set: { 
          likes: likeCount,
          dislikes: dislikeCount
        } 
      }
    );
  } catch (error) {
    console.error('Error updating reaction counts:', error);
  }
}

// =============================================
// LEADERBOARD ROUTES
// =============================================

// Get points leaderboard (public - requires API key)
app.get('/api/leaderboard/points', validateApiKey, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const database = client.db(DB_NAME);
    const users = database.collection('users');
    
    const leaderboard = await users.find({ 
      points: { $exists: true, $gt: 0 } 
    })
    .sort({ points: -1 })
    .limit(parseInt(limit))
    .project({
      id: 1,
      name: 1,
      email: 1,
      points: 1,
      lastActivity: 1
    })
    .toArray();
    
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching points leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Get engagement leaderboard (public - requires API key)
app.get('/api/leaderboard/engagement', validateApiKey, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    
    // This would require more complex aggregation
    // For now, returning points leaderboard as engagement proxy
    const users = database.collection('users');
    
    const engagementBoard = await users.find({ 
      points: { $exists: true, $gt: 0 } 
    })
    .sort({ points: -1, lastActivity: -1 })
    .limit(10)
    .project({
      id: 1,
      name: 1,
      email: 1,
      points: 1,
      lastActivity: 1
    })
    .toArray();
    
    res.json(engagementBoard);
  } catch (error) {
    console.error('Error fetching engagement leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch engagement leaderboard' });
  }
});

// =============================================
// ADMIN DASHBOARD ROUTES
// =============================================

// Get dashboard stats (admin only)
app.get('/api/admin/stats', validateApiKey, requireRole(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    
    const usersCount = await database.collection('users').countDocuments();
    const reportsCount = await database.collection(REPORTS_COLLECTION).countDocuments();
    const coordinatesCount = await database.collection(COORDINATES_COLLECTION).countDocuments();
    const postsCount = await database.collection(POSTS_COLLECTION).countDocuments();
    const commentsCount = await database.collection(COMMENTS_COLLECTION).countDocuments();
    
    const pendingReports = await database.collection(REPORTS_COLLECTION).countDocuments({ status: 'pending' });
    const pendingPosts = await database.collection(POSTS_COLLECTION).countDocuments({ status: 'pending' });
    
    res.json({
      users: usersCount,
      reports: reportsCount,
      coordinates: coordinatesCount,
      posts: postsCount,
      comments: commentsCount,
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
      auth: 'API Key System (USER, EDITOR, ADMIN)',
      security: 'All endpoints require API key',
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
    version: '2.0.0',
    database: 'MongoDB Atlas',
    auth: 'API Key Security System',
    security: 'All endpoints require API key header (X-API-Key)',
    user_roles: {
      '0': 'Regular User',
      '1': 'Editor',
      '2': 'Admin'
    },
    timestamp: new Date().toISOString(),
    endpoints: {
      reports: [
        'GET  /api/reports (API key required)',
        'POST /api/reports (API key required)',
        'PUT  /api/reports/:id (Editor+ API key)',
        'DELETE /api/reports/:id (Admin API key)'
      ],
      coordinates: [
        'GET  /api/coordinates (API key required)',
        'POST /api/coordinates (API key required)',
        'PUT  /api/coordinates/:id (Editor+ API key)',
        'DELETE /api/coordinates/:id (Admin API key)'
      ],
      posts: [
        'GET  /api/posts/feed (API key required)',
        'GET  /api/posts (Editor+ API key)',
        'POST /api/posts (Editor+ API key)',
        'PUT  /api/posts/:id (Editor+ API key)',
        'DELETE /api/posts/:id (Admin API key)'
      ],
      comments: [
        'GET  /api/comments/:parentType/:parentId (API key required)',
        'POST /api/comments (API key required)',
        'PUT  /api/comments/:id (API key required)',
        'DELETE /api/comments/:id (API key required)'
      ],
      reactions: [
        'GET  /api/reactions/:parentType/:parentId (API key required)',
        'POST /api/reactions (API key required)'
      ],
      leaderboards: [
        'GET  /api/leaderboard/points (API key required)',
        'GET  /api/leaderboard/engagement (API key required)'
      ],
      admin: [
        'GET  /api/admin/stats (Admin API key)'
      ],
      user_management: [
        'POST /api/users/sync (API key required - login)',
        'POST /api/users/verify-role (API key required - role check)',
        'POST /api/users (API key required - registration)',
        'GET  /api/users/email/:email (API key required - auth)',
        'GET  /api/users/me (API key required - get profile)',
        'PUT  /api/users/:userId/profile (API key required - update profile)',
        'PUT  /api/users/:userId/activity (API key required - update activity)',
        'GET  /api/users (Admin API key - list all users)',
        'GET  /api/users/:userId (Admin API key - get user)',
        'PUT  /api/users/:userId/role (Admin API key - update role)',
        'PUT  /api/users/:userId/status (Admin API key - update status)',
        'DELETE /api/users/:userId (Admin API key - delete user)'
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
  console.log(`🔑 API Key Security System: USER, EDITOR, ADMIN`);
  console.log(`🔒 Security: All endpoints require API key`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${DB_NAME}`);
  console.log(`💬 New Features: Comments, Reactions, Points System`);
  console.log(`🏆 Leaderboards: Points & Engagement`);
  console.log(`📋 Public data access: All GET endpoints require API key`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
});