const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const { errorHandler } = require('./middleware/errorHandler');
const { optionalAuth } = require('./middleware/auth');
const { createRateLimiter } = require('./middleware/rateLimiter');
const urlController = require('./controllers/urlController');

// Routes
const urlRoutes = require('./routes/urlRoutes');
const authRoutes = require('./routes/authRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

// Trust proxy (for rate limiting IP detection behind reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable for dev (embedded scripts)
  crossOriginEmbedderPolicy: false,
}));

// CORS
app.use(cors({
  origin: env.NODE_ENV === 'production' ? env.BASE_URL : '*',
  credentials: true,
}));

// Compression
app.use(compression());

// Logging
if (env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Swagger API docs
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'URL Shortener API',
      version: '1.0.0',
      description: 'Production-grade URL Shortener SaaS API',
    },
    servers: [
      { url: env.BASE_URL, description: 'Current server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'NanoURL API Docs',
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', urlRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);

// SPA pages — MUST be before the shortcode wildcard route
const pages = ['dashboard', 'login', 'signup', 'pricing'];
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', `${page}.html`));
  });
});

// Short URL redirect handler (must be AFTER API routes AND page routes)
app.get('/:shortCode([a-zA-Z0-9_-]{3,30})',
  optionalAuth,
  createRateLimiter('redirect'),
  urlController.redirectUrl
);

// 404 handler
app.use((req, res) => {
  // If it's an API request, return JSON
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      error: 'Endpoint not found',
    });
  }
  // Otherwise serve landing page
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
