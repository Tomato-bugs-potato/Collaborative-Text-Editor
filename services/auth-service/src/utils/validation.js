const Joi = require('joi');
const { createErrorResponse } = require('../../shared-utils');

// Schema for user registration
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(8)
    .pattern(new RegExp('^[a-zA-Z0-9]{3,30}$'))
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.pattern.base': 'Password must contain only alphanumeric characters'
    }),
  name: Joi.string().min(2).max(50).required()
});

// Schema for user login
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Schema for Google OAuth callback
const googleAuthSchema = Joi.object({
    googleId: Joi.string().required(),
    email: Joi.string().email().required(),
    name: Joi.string().required()
});

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      const errorMessage = error.details.map((detail) => detail.message).join(', ');
      return res.status(400).json(createErrorResponse(`Validation error: ${errorMessage}`, 400));
    }

    req.body = value;
    next();
  };
};

module.exports = {
  validate,
  registerSchema,
    loginSchema,
    googleAuthSchema,
    passwordPattern
};
