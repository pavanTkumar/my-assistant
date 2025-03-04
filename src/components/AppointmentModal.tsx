import React, { useState, useEffect } from 'react';
import styles from './AppointmentModal.module.css';

interface TimeSlot {
  start: string;
  end: string;
  time: string;
}

interface AppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const AppointmentModal: React.FC<AppointmentModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [date, setDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [purpose, setPurpose] = useState('');
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Calculate minimum date (today)
  const today = new Date();
  const minDate = today.toISOString().split('T')[0];

  // Calculate maximum date (3 months from now)
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 3);
  const maxDateStr = maxDate.toISOString().split('T')[0];

  // Handle modal close
  const handleClose = () => {
    setStep(1);
    setName('');
    setEmail('');
    setDate('');
    setSelectedSlot(null);
    setPurpose('');
    setAvailableSlots([]);
    setError('');
    onClose();
  };

  // Fetch available slots when date changes
  useEffect(() => {
    const fetchSlots = async () => {
      if (!date) return;
      
      setIsLoading(true);
      setError('');
      
      try {
        const response = await fetch(`/api/calendar/slots?date=${date}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch available slots');
        }
        
        setAvailableSlots(data.availableSlots);
        
        // If no slots available, show error
        if (data.availableSlots.length === 0) {
          setError('No available slots for this date. Please try another date.');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch available slots');
        setAvailableSlots([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchSlots();
  }, [date]);

  // Handle form submission (final step)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !email || !date || !selectedSlot) {
      setError('Please fill in all required fields');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/calendar/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email,
          date,
          time: selectedSlot.time,
          purpose: purpose || 'Meeting with Pavan Tejavath',
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to book appointment');
      }
      
      // Success message
      onSuccess(`Appointment successfully booked for ${date} at ${selectedSlot.time}`);
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to book appointment');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle step navigation
  const goToNextStep = () => {
    if (step === 1 && (!name || !email)) {
      setError('Please enter your name and email');
      return;
    }
    
    if (step === 2 && (!date || !selectedSlot)) {
      setError('Please select a date and time slot');
      return;
    }
    
    setError('');
    setStep(step + 1);
  };

  const goToPreviousStep = () => {
    setError('');
    setStep(step - 1);
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        <button className={styles.closeButton} onClick={handleClose}>×</button>
        
        <h2 className={styles.modalTitle}>Book an Appointment</h2>
        
        {/* Progress indicator */}
        <div className={styles.progressBar}>
          <div 
            className={`${styles.progressStep} ${step >= 1 ? styles.active : ''}`}
            onClick={() => step > 1 && setStep(1)}
          >
            1. Your Info
          </div>
          <div 
            className={`${styles.progressStep} ${step >= 2 ? styles.active : ''}`}
            onClick={() => step > 2 && setStep(2)}
          >
            2. Date & Time
          </div>
          <div 
            className={`${styles.progressStep} ${step >= 3 ? styles.active : ''}`}
          >
            3. Confirm
          </div>
        </div>
        
        {/* Error message */}
        {error && <div className={styles.errorMessage}>{error}</div>}
        
        {/* Step 1: Contact Information */}
        {step === 1 && (
          <div className={styles.formSection}>
            <h3>Your Contact Information</h3>
            <div className={styles.formGroup}>
              <label htmlFor="name">Full Name *</label>
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
              <label htmlFor="email">Email Address *</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
              />
            </div>
            
            <div className={styles.formActions}>
              <button 
                className={styles.secondaryButton} 
                onClick={handleClose}
              >
                Cancel
              </button>
              <button 
                className={styles.primaryButton} 
                onClick={goToNextStep}
              >
                Next
              </button>
            </div>
          </div>
        )}
        
        {/* Step 2: Date and Time Selection */}
        {step === 2 && (
          <div className={styles.formSection}>
            <h3>Select Date and Time</h3>
            
            <div className={styles.formGroup}>
              <label htmlFor="date">Date *</label>
              <input
                type="date"
                id="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSelectedSlot(null);
                }}
                min={minDate}
                max={maxDateStr}
                required
              />
            </div>
            
            {isLoading ? (
              <div className={styles.loading}>Loading available slots...</div>
            ) : date && availableSlots.length > 0 ? (
              <div className={styles.timeSlots}>
                <label>Available Time Slots *</label>
                <div className={styles.slotGrid}>
                  {availableSlots.map((slot) => (
                    <button
                      key={slot.time}
                      className={`${styles.timeSlot} ${selectedSlot?.time === slot.time ? styles.selectedSlot : ''}`}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              </div>
            ) : date ? (
              <div className={styles.noSlots}>
                No available slots for this date. Please try another date.
              </div>
            ) : null}
            
            <div className={styles.formActions}>
              <button 
                className={styles.secondaryButton} 
                onClick={goToPreviousStep}
              >
                Back
              </button>
              <button 
                className={styles.primaryButton} 
                onClick={goToNextStep}
                disabled={!date || !selectedSlot}
              >
                Next
              </button>
            </div>
          </div>
        )}
        
        {/* Step 3: Confirmation */}
        {step === 3 && (
          <div className={styles.formSection}>
            <h3>Confirm Your Appointment</h3>
            
            <div className={styles.summaryInfo}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Name:</span>
                <span className={styles.summaryValue}>{name}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Email:</span>
                <span className={styles.summaryValue}>{email}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Date:</span>
                <span className={styles.summaryValue}>{date}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Time:</span>
                <span className={styles.summaryValue}>{selectedSlot?.time}</span>
              </div>
            </div>
            
            <div className={styles.formGroup}>
              <label htmlFor="purpose">Purpose of Meeting (Optional)</label>
              <textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Briefly describe the purpose of this meeting"
                rows={3}
              />
            </div>
            
            <div className={styles.formActions}>
              <button 
                className={styles.secondaryButton} 
                onClick={goToPreviousStep}
              >
                Back
              </button>
              <button 
                className={styles.primaryButton} 
                onClick={handleSubmit}
                disabled={isLoading}
              >
                {isLoading ? 'Booking...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentModal;