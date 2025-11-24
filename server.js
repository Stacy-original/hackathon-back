const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');

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
  credentials: true, // This is crucial for cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Accept'],
  exposedHeaders: ['set-cookie']
}));

// Handle preflight requests
app.options('*', cors());

// Body parser middleware
app.use(express.json({ limit: '50mb' }));

// Session configuration for cross-domain
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // Must be true for HTTPS in production
    httpOnly: true,
    sameSite: 'none', // Crucial for cross-domain
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

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
const SESSIONS_COLLECTION = 'sessions';

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

// Simple session cleanup function
async function cleanupExpiredSessions() {
  try {
    const database = client.db(DB_NAME);
    const sessions = database.collection(SESSIONS_COLLECTION);
    const result = await sessions.deleteMany({
      expires: { $lt: new Date() }
    });
    if (result.deletedCount > 0) {
      console.log(`Cleaned up ${result.deletedCount} expired sessions`);
    }
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// =============================================
// PASSPORT GOOGLE OAUTH STRATEGY
// =============================================

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/google/callback`,
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    console.log('Google OAuth profile received:', profile.displayName);
    console.log('Profile email:', profile.emails?.[0]?.value);
    
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    
    // Check if user already exists by googleId OR email
    let user = await users.findOne({ 
      $or: [
        { googleId: profile.id },
        { email: profile.emails[0].value }
      ]
    });
    
    if (user) {
      console.log('Existing user found:', user.email);
      
      // Update googleId if missing (for migration)
      if (!user.googleId) {
        await users.updateOne(
          { _id: user._id },
          { $set: { googleId: profile.id } }
        );
        user.googleId = profile.id;
      }
      
      // Update last login time and profile info
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
      return done(null, user);
    } else {
      console.log('Creating new user for:', profile.emails[0].value);
      // Create new user
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

// Serialize user to session
passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const database = client.db(DB_NAME);
    const users = database.collection(USERS_COLLECTION);
    const user = await users.findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (error) {
    console.error('Error deserializing user:', error);
    done(error, null);
  }
});

// =============================================
// AUTHENTICATION MIDDLEWARE
// =============================================

// Check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
};

// =============================================
// AUTHENTICATION ROUTES
// =============================================

// Start Google OAuth flow
// =============================================
// AUTHENTICATION ROUTES
// =============================================

// Debug OAuth flow
app.get('/auth/debug-oauth', (req, res) => {
  console.log('=== OAUTH DEBUG ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session:', req.session);
  console.log('Is Authenticated:', req.isAuthenticated());
  console.log('User:', req.user);
  console.log('Cookies:', req.headers.cookie);
  
  res.json({
    sessionId: req.sessionID,
    hasSession: !!req.session,
    isAuthenticated: req.isAuthenticated(),
    user: req.user,
    cookies: req.headers.cookie
  });
});


app.get('/auth/google',
  (req, res, next) => {
    // Store redirect URL if provided
    if (req.query.redirect) {
      req.session.oauthRedirect = req.query.redirect;
    }
    next();
  },
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'consent'  // Force consent screen every time
  })
);

// Google OAuth callback
// Google OAuth callback
app.get('/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=auth_failed`
  }),
  (req, res) => {
    console.log('=== CALLBACK DEBUG ===');
    console.log('After passport.authenticate:');
    console.log('Session ID:', req.sessionID);
    console.log('Is Authenticated:', req.isAuthenticated());
    console.log('User:', req.user);
    
    // Successful authentication, redirect home
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/`);
  }
);

// Get current user info
app.get('/auth/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      user: {
        id: req.user._id,
        googleId: req.user.googleId,
        name: req.user.name,
        email: req.user.email,
        photo: req.user.photo,
        role: req.user.role,
        isActive: req.user.isActive
      },
      isAuthenticated: true
    });
  } else {
    res.json({ 
      user: null,
      isAuthenticated: false 
    });
  }
});

// Debug endpoint to check session
app.get('/auth/debug', (req, res) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  console.log('User authenticated:', req.isAuthenticated());
  console.log('User:', req.user);
  console.log('Cookies:', req.headers.cookie);
  
  res.json({
    sessionId: req.sessionID,
    session: req.session,
    isAuthenticated: req.isAuthenticated(),
    user: req.user,
    cookies: req.headers.cookie
  });
});

// Logout user
app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.json({ message: 'Logged out successfully' });
    });
  });
});

// Check auth status
app.get('/auth/status', (req, res) => {
  res.json({ 
    isAuthenticated: req.isAuthenticated(),
    user: req.isAuthenticated() ? {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    } : null
  });
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
      updatedAt: new Date(),
      // Add user info if authenticated
      userId: req.isAuthenticated() ? req.user._id.toString() : null,
      userEmail: req.isAuthenticated() ? req.user.email : (email || ''),
      userName: req.isAuthenticated() ? req.user.name : ''
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
      userId: req.user._id.toString() 
    }).sort({ createdAt: -1 }).toArray();
    
    res.json(userReports);
  } catch (error) {
    console.error('Error fetching user reports:', error);
    res.status(500).json({ error: 'Failed to fetch user reports' });
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

// =============================================
// COORDINATES API ROUTES
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
      // Add user info if authenticated
      userId: req.isAuthenticated() ? req.user._id.toString() : null,
      userEmail: req.isAuthenticated() ? req.user.email : '',
      userName: req.isAuthenticated() ? req.user.name : ''
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

// =============================================
// POSTS API ROUTES
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

// Get single post by ID
app.get('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);

    const post = await posts.findOne({ _id: new ObjectId(id) });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(post);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Create new post
app.post('/api/posts', async (req, res) => {
  try {
    const { 
      title, 
      content, 
      description, 
      severity, 
      type, 
      location, 
      imageUrl, 
      videoUrl, 
      status = 'pending',
      tags = []
    } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Missing required fields: title, content' });
    }

    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);
    
    const newPost = {
      title,
      content,
      description: description || '',
      severity: severity || 'medium',
      type: type || 'news',
      location: location || '',
      imageUrl: imageUrl || '',
      videoUrl: videoUrl || '',
      tags: Array.isArray(tags) ? tags : [tags],
      status: status,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: status === 'approved' ? new Date() : null,
      // Add user info if authenticated
      userId: req.isAuthenticated() ? req.user._id.toString() : null,
      userEmail: req.isAuthenticated() ? req.user.email : '',
      userName: req.isAuthenticated() ? req.user.name : ''
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

// Update post status (approve/reject)
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, 
      content, 
      description, 
      severity, 
      type, 
      location, 
      imageUrl, 
      videoUrl, 
      status,
      tags 
    } = req.body;

    const database = client.db(DB_NAME);
    const posts = database.collection(POSTS_COLLECTION);

    const updateData = {
      updatedAt: new Date()
    };

    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (description !== undefined) updateData.description = description;
    if (severity !== undefined) updateData.severity = severity;
    if (type !== undefined) updateData.type = type;
    if (location !== undefined) updateData.location = location;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (videoUrl !== undefined) updateData.videoUrl = videoUrl;
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [tags];
    
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'approved' && !req.body.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    const result = await posts.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post
app.delete('/api/posts/:id', async (req, res) => {
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
// USER MANAGEMENT ROUTES
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
      auth: 'Google OAuth enabled',
      environment: process.env.NODE_ENV || 'development',
      envVars: {
        hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        hasSessionSecret: !!process.env.SESSION_SECRET,
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
    auth: 'Google OAuth Enabled',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: [
        'GET  /auth/google',
        'GET  /auth/user',
        'GET  /auth/status',
        'POST /auth/logout'
      ],
      reports: [
        'GET  /api/reports',
        'POST /api/reports',
        'GET  /api/my-reports (auth required)'
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
  console.log(`🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured'}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${DB_NAME}`);
  console.log(`🔑 Auth routes:`);
  console.log(`   - GET  http://0.0.0.0:${PORT}/auth/google`);
  console.log(`   - GET  http://0.0.0.0:${PORT}/auth/user`);
  console.log(`   - POST http://0.0.0.0:${PORT}/auth/logout`);
  console.log(`🏥 Health check: http://0.0.0.0:${PORT}/health`);
});