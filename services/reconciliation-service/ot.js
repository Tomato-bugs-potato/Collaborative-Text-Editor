/**
 * Operational Transformation (OT) Module
 * 
 * Implements text-based OT for collaborative editing.
 * Uses the ot-text library for core transformation logic.
 */

const text = require('ot-text');

/**
 * Transforms operation 'op' against a concurrent operation 'otherOp'.
 * Used when two users edit the same document simultaneously.
 * 
 * @param {Array} op - The operation to transform
 * @param {Array} otherOp - The operation to transform against
 * @param {string} side - 'left' or 'right' to break ties
 * @returns {Array} - The transformed operation
 */
function transformOperation(op, otherOp, side = 'left') {
    try {
        // ot-text uses 'left' for the operation that happened first
        // and 'right' for the operation that happened second
        return text.type.transform(op, otherOp, side);
    } catch (error) {
        console.error('OT Transform error:', error);
        // If transform fails, return original op (safe fallback)
        return op;
    }
}

/**
 * Applies an operation to a document string.
 * 
 * @param {string} document - The current document content
 * @param {Array} op - The operation to apply
 * @returns {string} - The new document content
 */
function applyOperation(document, op) {
    try {
        return text.type.apply(document, op);
    } catch (error) {
        console.error('OT Apply error:', error);
        // Return original document on error
        return document;
    }
}

/**
 * Composes two operations into a single operation.
 * This is useful for combining sequential operations from the same user.
 * 
 * @param {Array} op1 - First operation
 * @param {Array} op2 - Second operation
 * @returns {Array} - Combined operation
 */
function composeOperations(op1, op2) {
    try {
        return text.type.compose(op1, op2);
    } catch (error) {
        console.error('OT Compose error:', error);
        return op2; // Return the latest op on error
    }
}

/**
 * Converts a simple insert/delete action to OT operation format.
 * 
 * OT-Text operation format:
 * - Skip N characters: N (positive integer)
 * - Insert string: "text" (string)
 * - Delete N characters: { d: N } or negative number
 * 
 * @param {Object} action - { type: 'insert'|'delete', position: number, text?: string, length?: number }
 * @param {number} docLength - Current document length
 * @returns {Array} - OT operation
 */
function actionToOperation(action, docLength) {
    const op = [];

    if (action.position > 0) {
        op.push(action.position); // Skip to position
    }

    if (action.type === 'insert' && action.text) {
        op.push(action.text);
        const remaining = docLength - action.position;
        if (remaining > 0) {
            op.push(remaining);
        }
    } else if (action.type === 'delete' && action.length) {
        op.push({ d: action.length });
        const remaining = docLength - action.position - action.length;
        if (remaining > 0) {
            op.push(remaining);
        }
    }

    return op;
}

/**
 * Validates that an operation is valid for a document of given length.
 * 
 * @param {Array} op - The operation to validate
 * @param {number} docLength - The document length
 * @returns {boolean} - Whether the operation is valid
 */
function validateOperation(op, docLength) {
    try {
        let cursor = 0;
        for (const component of op) {
            if (typeof component === 'number') {
                if (component < 0) {
                    cursor -= component; // Delete
                } else {
                    cursor += component; // Skip
                }
            } else if (typeof component === 'string') {
                // Insert doesn't move cursor in source
            } else if (component && typeof component.d === 'number') {
                cursor += component.d;
            }
        }
        return cursor <= docLength;
    } catch (error) {
        return false;
    }
}

module.exports = {
    transformOperation,
    applyOperation,
    composeOperations,
    actionToOperation,
    validateOperation,
    // Export the underlying type for advanced usage
    textType: text.type
};
