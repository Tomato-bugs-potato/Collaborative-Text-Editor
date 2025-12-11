const Joi = require('joi');
const { createErrorResponse } = require('../../shared-utils');

// Password complexity: 8+ chars, uppercase, lowercase, number, special char
// Allow letters, numbers, and common special characters
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:'",.<>\/~`])[A-Za-z\d@$!%*?&#^()_+\-=\[\]{}|;:'",.<>\/~`]{8,}$/;

// Schema for user registration
const registerSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string()
        .min(8)
        .pattern(passwordPattern)
        .required()
        .messages({
            'string.min': 'Password must be at least 8 characters long',
            'string.pattern.base': 'Password must contain at least 8 characters with one uppercase letter, one lowercase letter, one number, and one special character'
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
        const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });

        if (error) {
            const errorMessage = error.details.map(detail => detail.message).join(', ');
            return res.status(400).json(createErrorResponse(`Validation error: ${errorMessage}`, 400));
        }

        // Replace req.body with validated value
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
