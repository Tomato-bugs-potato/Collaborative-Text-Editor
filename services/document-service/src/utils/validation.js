const Joi = require('joi');
const { createErrorResponse } = require('../../shared-utils');

// Schema for creating a document
const createDocumentSchema = Joi.object({
    title: Joi.string().trim().max(100).optional().allow(''),
    content: Joi.alternatives().try(Joi.object(), Joi.string()).optional()
});

// Schema for updating a document
const updateDocumentSchema = Joi.object({
    title: Joi.string().trim().max(100).optional(),
    data: Joi.alternatives().try(Joi.object(), Joi.string()).optional()
});

// Schema for adding a collaborator
const addCollaboratorSchema = Joi.object({
    userId: Joi.number().integer().required(),
    role: Joi.string().valid('viewer', 'editor', 'owner').default('editor')
});

// Validation middleware factory
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false });

        if (error) {
            const errorMessage = error.details.map(detail => detail.message).join(', ');
            return res.status(400).json(createErrorResponse(`Validation error: ${errorMessage}`, 400));
        }

        // Replace req.body with validated value (converts types if needed)
        req.body = value;
        next();
    };
};

module.exports = {
    validate,
    createDocumentSchema,
    updateDocumentSchema,
    addCollaboratorSchema
};
