import React, { useState } from 'react';
import styles from './MessageModal.module.css';

interface MessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const MessageModal: React.FC<MessageModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle modal close
  const handleClose = () => {
    setName('');
    setEmail('');
    setMessage('');
    setUrgent(false);
    setError('');
    onClose();
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !email || !message) {
      setError('Please fill in all required fields');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email,
          message,
          urgent,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send message');
      }
      
      // Success message
      onSuccess(`Your message has been sent to Pavan${urgent ? ' as urgent' : ''}. You'll hear back soon.`);
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        <button className={styles.closeButton} onClick={handleClose}>×</button>
        
        <h2 className={styles.modalTitle}>Send a Message to Pavan</h2>
        
        {/* Error message */}
        {error && <div className={styles.errorMessage}>{error}</div>}
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Your Name *</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              required
            />
          </div>
          
          <div className={styles.formGroup}>
            <label htmlFor="email">Your Email *</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              required
            />
          </div>
          
          <div className={styles.formGroup}>
            <label htmlFor="message">Your Message *</label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What would you like to say to Pavan?"
              rows={5}
              required
            />
          </div>
          
          <div className={styles.checkboxGroup}>
            <input
              type="checkbox"
              id="urgent"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
            />
            <label htmlFor="urgent">Mark as urgent</label>
          </div>
          
          <div className={styles.formActions}>
            <button 
              type="button"
              className={styles.secondaryButton} 
              onClick={handleClose}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className={styles.primaryButton}
              disabled={isLoading}
            >
              {isLoading ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MessageModal;