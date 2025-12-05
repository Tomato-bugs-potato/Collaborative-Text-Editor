import React, { useState, useEffect } from 'react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost';
const AUTH_BASE_URL = `${API_BASE_URL}/api/auth`;
const DOCUMENTS_BASE_URL = `${API_BASE_URL}/api/documents`;

export default function ShareModal({ documentId, onClose }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState('editor');

  // Load current collaborators
  useEffect(() => {
    loadCollaborators();
  }, [documentId]);

  const loadCollaborators = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${DOCUMENTS_BASE_URL}/${documentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data.collaborators) {
          setCollaborators(data.data.collaborators);
        }
      }
    } catch (error) {
      console.error('Error loading collaborators:', error);
    }
  };

  const searchUsers = async (query) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${AUTH_BASE_URL}/users/search?q=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSearchResults(data.data);
        }
      }
    } catch (error) {
      console.error('Error searching users:', error);
    }
  };

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchTerm(query);
    searchUsers(query);
  };

  const addCollaborator = async (userId, userEmail, userName) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('authToken');

      const response = await fetch(`${DOCUMENTS_BASE_URL}/${documentId}/collaborators`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: parseInt(userId),
          role: selectedRole
        })
      });

      if (response.ok) {
        // Add to local collaborators list
        setCollaborators(prev => [...prev, {
          userId: parseInt(userId),
          role: selectedRole,
          user: { email: userEmail, name: userName }
        }]);
        setSearchTerm('');
        setSearchResults([]);
      } else {
        const error = await response.json();
        alert(`Error adding collaborator: ${error.message}`);
      }
    } catch (error) {
      console.error('Error adding collaborator:', error);
      alert('Error adding collaborator');
    } finally {
      setLoading(false);
    }
  };

  const removeCollaborator = async (userId) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('authToken');

      const response = await fetch(`${DOCUMENTS_BASE_URL}/${documentId}/collaborators/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        // Remove from local collaborators list
        setCollaborators(prev => prev.filter(c => c.userId !== parseInt(userId)));
      } else {
        const error = await response.json();
        alert(`Error removing collaborator: ${error.message}`);
      }
    } catch (error) {
      console.error('Error removing collaborator:', error);
      alert('Error removing collaborator');
    } finally {
      setLoading(false);
    }
  };

  const isAlreadyCollaborator = (userId) => {
    return collaborators.some(c => c.userId === parseInt(userId));
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '20px',
        width: '500px',
        maxWidth: '90vw',
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0 }}>Share Document</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '0'
            }}
          >
            ×
          </button>
        </div>

        {/* Add Collaborator Section */}
        <div style={{ marginBottom: '20px' }}>
          <h4>Add Collaborator</h4>

          <div style={{ marginBottom: '10px' }}>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              style={{ marginRight: '10px', padding: '5px' }}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="Search users by email or name..."
            value={searchTerm}
            onChange={handleSearchChange}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              marginBottom: '10px'
            }}
          />

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div style={{
              border: '1px solid #ddd',
              borderRadius: '4px',
              maxHeight: '200px',
              overflow: 'auto',
              marginBottom: '10px'
            }}>
              {searchResults.map(user => (
                <div key={user.id} style={{
                  padding: '10px',
                  borderBottom: '1px solid #eee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{user.name}</div>
                    <div style={{ color: '#666', fontSize: '14px' }}>{user.email}</div>
                  </div>
                  {!isAlreadyCollaborator(user.id) ? (
                    <button
                      onClick={() => addCollaborator(user.id, user.email, user.name)}
                      disabled={loading}
                      style={{
                        padding: '5px 10px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: loading ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Add
                    </button>
                  ) : (
                    <span style={{ color: '#28a745', fontSize: '14px' }}>Already added</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current Collaborators */}
        <div>
          <h4>Current Collaborators</h4>
          {collaborators.length === 0 ? (
            <p style={{ color: '#666', fontStyle: 'italic' }}>No collaborators yet</p>
          ) : (
            <div style={{ maxHeight: '200px', overflow: 'auto' }}>
              {collaborators.map(collaborator => (
                <div key={collaborator.userId} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px',
                  border: '1px solid #eee',
                  borderRadius: '4px',
                  marginBottom: '5px'
                }}>
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      {collaborator.user?.name || `User ${collaborator.userId}`}
                    </div>
                    <div style={{ color: '#666', fontSize: '14px', textTransform: 'capitalize' }}>
                      Role: {collaborator.role}
                    </div>
                  </div>
                  <button
                    onClick={() => removeCollaborator(collaborator.userId)}
                    disabled={loading}
                    style={{
                      padding: '5px 10px',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: loading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: '20px', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
