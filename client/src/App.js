import React, { useState, useEffect } from 'react';
import TextEditor from './TextEditor';
import Auth from './Auth';
import ShareModal from './ShareModal';
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect,
  useHistory
} from "react-router-dom";

const AUTH_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const DOCUMENTS_BASE_URL = process.env.REACT_APP_DOCUMENTS_URL || 'http://localhost:3002';

function DocumentList() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shareModal, setShareModal] = useState(null);
  const history = useHistory();

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${DOCUMENTS_BASE_URL}/documents`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data.data);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const createDocument = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${DOCUMENTS_BASE_URL}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: 'New Document'
        })
      });

      if (response.ok) {
        const data = await response.json();
        history.push(`/documents/${data.data.id}`);
      }
    } catch (error) {
      console.error('Error creating document:', error);
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    window.location.reload();
  };

  if (loading) {
    return <div>Loading documents...</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>My Documents</h1>
        <div>
          <button onClick={createDocument} style={{ marginRight: '10px', padding: '10px 20px' }}>
            New Document
          </button>
          <button onClick={logout} style={{ padding: '10px 20px' }}>
            Logout
          </button>
        </div>
      </div>

      {/* Share Modal */}
      {shareModal && (
        <ShareModal
          documentId={shareModal}
          onClose={() => setShareModal(null)}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
        {documents.map(doc => (
          <div
            key={doc.id}
            style={{
              border: '1px solid #ccc',
              borderRadius: '8px',
              padding: '15px',
              cursor: 'pointer',
              transition: 'box-shadow 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
          >
            <div onClick={() => history.push(`/documents/${doc.id}`)} style={{ cursor: 'pointer' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>
                {doc.title}
              </h3>
              <p style={{ margin: '0 0 10px 0', color: '#666', fontSize: '14px' }}>
                {new Date(doc.lastModified).toLocaleDateString()}
              </p>
              {doc.collaborators && doc.collaborators.length > 0 && (
                <p style={{ margin: '0 0 10px 0', color: '#666', fontSize: '14px' }}>
                  Shared with {doc.collaborators.length} collaborator{doc.collaborators.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  history.push(`/documents/${doc.id}`);
                }}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Open
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShareModal(doc.id);
                }}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Share
              </button>
            </div>
          </div>
        ))}
      </div>

      {documents.length === 0 && !loading && (
        <div style={{
          textAlign: 'center',
          marginTop: '50px',
          color: '#666',
          fontSize: '18px'
        }}>
          <p>No documents yet. Create your first document!</p>
        </div>
      )}
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in and validate token
    const checkAuth = async () => {
      const token = localStorage.getItem('authToken');
      const userData = localStorage.getItem('user');

      if (token && userData) {
        try {
          // Validate token by making a request to a protected endpoint
          const response = await fetch(`${DOCUMENTS_BASE_URL}/documents`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.ok) {
            setUser(JSON.parse(userData));
          } else {
            // Token is invalid, clear localStorage
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
          }
        } catch (error) {
          // Network error, clear localStorage to be safe
          localStorage.removeItem('authToken');
          localStorage.removeItem('user');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Router>
      {!user ? (
        <Auth onLogin={handleLogin} />
      ) : (
        <Switch>
          <Route path="/" exact>
            <DocumentList />
          </Route>
          <Route path="/documents/:id">
            <TextEditor />
          </Route>
          <Redirect to="/" />
        </Switch>
      )}
    </Router>
  );
}

export default App;