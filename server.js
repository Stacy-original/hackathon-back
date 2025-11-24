const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================
// MIDDLEWARE CONFIGURATION
// =============================================

// Enhanced CORS configuration for cross-domain
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
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

// Initialize Passport (without sessions)
app.use(passport.initialize());

// =============================================
// JWT CONFIGURATION
// =============================================

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

// JWT token generation function
function generateToken(user) {
  const payload = {
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    photo: user.photo
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
// PASSPORT GOOGLE OAUTH STRATEGY (JWT VERSION)
// =============================================

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/google/callback`,
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    console.log('Google OAuth profile received:', profile.displayName);
    
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    let user = await users.findOne({ 
      $or: [
        { googleId: profile.id },
        { email: profile.emails[0].value }
      ]
    });
    
    if (user) {
      console.log('Existing user found:', user.email);
      
      if (!user.googleId) {
        await users.updateOne(
          { _id: user._id },
          { $set: { googleId: profile.id } }
        );
        user.googleId = profile.id;
      }
      
      await users.updateOne(
        { _id: user._id },
        { 
          $set: { 
            lastLogin: new Date(),
            name: profile.displayName,
            photo: profile.photos[0].value
          } 
        }
      );
      
      // Return the updated user
      const updatedUser = await users.findOne({ _id: user._id });
      return done(null, updatedUser);
    } else {
      console.log('Creating new user for:', profile.emails[0].value);
      const newUser = {
        googleId: profile.id,
        name: profile.displayName,
        email: profile.emails[0].value,
        photo: profile.photos[0].value,
        role: 'user',
        isActive: true,
        createdAt: new Date(),
        lastLogin: new Date()
      };
      
      const result = await users.insertOne(newUser);
      newUser._id = result.insertedId;
      console.log('New user created successfully');
      return done(null, newUser);
    }
  } catch (error) {
    console.error('Error in Google Strategy:', error);
    return done(error, null);
  }
}));

// =============================================
// AUTHENTICATION MIDDLEWARE (JWT VERSION)
// =============================================

// Check if user is authenticated
const requireAuth = (req, res, next) => {
  verifyToken(req, res, next);
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  verifyToken(req, res, (err) => {
    if (err) return next(err);
    
    if (req.user.role === 'admin') {
      return next();
    }
    res.status(403).json({ error: 'Admin access required' });
  });
};

// =============================================
// AUTHENTICATION ROUTES (JWT VERSION)
// =============================================

// Start Google OAuth flow
app.get('/auth/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false // No sessions
  })
);

// Google OAuth callback with JWT
app.get('/auth/google/callback', 
  passport.authenticate('google', { session: false }),
  (req, res) => {
    try {
      console.log('OAuth callback successful for user:', req.user.email);
      
      // Generate JWT token
      const token = generateToken(req.user);
      
      // Construct redirect URL with token
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/auth/success?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify({
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        photo: req.user.photo,
        role: req.user.role
      }))}`;
      
      console.log('Redirecting to:', redirectUrl);
      res.redirect(redirectUrl);
    } catch (error) {
      console.error('Error in OAuth callback:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/login?error=auth_failed`);
    }
  }
);

// Get current user info (JWT version)
app.get('/auth/user', verifyToken, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const user = await users.findOne({ _id: new ObjectId(req.user.userId) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ 
      user: {
        id: user._id,
        googleId: user.googleId,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role,
        isActive: user.isActive
      },
      isAuthenticated: true
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Token validation endpoint
app.post('/auth/validate', verifyToken, (req, res) => {
  res.json({ 
    valid: true,
    user: req.user
  });
});

// Token refresh endpoint
app.post('/auth/refresh', verifyToken, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const user = await users.findOne({ _id: new ObjectId(req.user.userId) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate new token
    const newToken = generateToken(user);
    
    res.json({ 
      token: newToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Manual login endpoint (for testing)
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // This is a simplified version - you might want to implement proper password auth
    // For now, we'll just generate a token for any existing user
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    const user = await users.findOne({ email });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(user);
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout user (JWT version - client-side token removal)
app.post('/auth/logout', (req, res) => {
  // With JWT, logout is handled client-side by removing the token
  res.json({ message: 'Logged out successfully - remove token client-side' });
});

// Check auth status
app.get('/auth/status', verifyToken, (req, res) => {
  res.json({ 
    isAuthenticated: true,
    user: req.user
  });
});

// =============================================
// REPORTS API ROUTES (UPDATED FOR JWT)
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
    const { type, location, coordinates, description, severity, email, phone } = req.body;
    
    if (!type || !location || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    
    // Extract user from token if provided
    let userInfo = {};
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        userInfo = {
          userId: decoded.userId,
          userEmail: decoded.email,
          userName: decoded.name
        };
      } catch (error) {
        // Token is invalid, proceed as anonymous
        console.log('Invalid token, submitting as anonymous');
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

// Get user's own reports (requires authentication)
app.get('/api/my-reports', requireAuth, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const reports = database.collection(REPORTS_COLLECTION);
    const userReports = await reports.find({ 
      userId: req.user.userId
    }).sort({ createdAt: -1 }).toArray();
    
    res.json(userReports);
  } catch (error) {
    console.error('Error fetching user reports:', error);
    res.status(500).json({ error: 'Failed to fetch user reports' });
  }
});

// [Keep all other report routes the same, just update requireAuth to use JWT version]
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

// =============================================
// COORDINATES API ROUTES (UPDATED FOR JWT)
// =============================================

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
    
    // Extract user from token if provided
    let userInfo = {};
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        userInfo = {
          userId: decoded.userId,
          userEmail: decoded.email,
          userName: decoded.name
        };
      } catch (error) {
        // Token is invalid, proceed as anonymous
        console.log('Invalid token, submitting as anonymous');
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

// [Keep all other coordinate routes the same...]

// =============================================
// POSTS API ROUTES (UPDATED FOR JWT)
// =============================================

// Get all posts (for admin)
app.get('/api/posts', async (req, res) => {
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

// Get approved posts for feed
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

// [Keep all other post routes the same, just update authentication to use JWT where needed]

// =============================================
// USER MANAGEMENT ROUTES (UPDATED FOR JWT)
// =============================================

// Get all users (admin only)
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    const allUsers = await users.find({}).sort({ createdAt: -1 }).toArray();
    
    // Remove sensitive data
    const safeUsers = allUsers.map(user => ({
      id: user._id,
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
app.put('/api/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !['user', 'admin', 'moderator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);

    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: role, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
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
      auth: 'Google OAuth with JWT enabled',
      environment: process.env.NODE_ENV || 'development',
      envVars: {
        hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        hasJwtSecret: !!process.env.JWT_SECRET,
        frontendUrl: process.env.FRONTEND_URL,
        backendUrl: process.env.BACKEND_URL
      }
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
    auth: 'Google OAuth with JWT',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: [
        'GET  /auth/google',
        'GET  /auth/user (JWT required)',
        'POST /auth/validate (JWT required)',
        'POST /auth/refresh (JWT required)',
        'POST /auth/logout'
      ],
      reports: [
        'GET  /api/reports',
        'POST /api/reports',
        'GET  /api/my-reports (JWT required)'
      ],
      coordinates: [
        'GET  /api/coordinates',
        'POST /api/coordinates'
      ],
      posts: [
        'GET  /api/posts',
        'GET  /api/posts/feed',
        'POST /api/posts'
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
  console.log(`🔐 Google OAuth with JWT: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured'}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${DB_NAME}`);
  console.log(`🔑 Auth routes:`);
  console.log(`   - GET  http://0.0.0.0:${PORT}/auth/google`);
  console.log(`   - GET  http://0.0.0.0:${PORT}/auth/user (JWT required)`);
  console.log(`   - POST http://0.0.0.0:${PORT}/auth/validate`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
});