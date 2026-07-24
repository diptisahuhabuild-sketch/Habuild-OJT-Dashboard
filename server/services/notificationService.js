const nodemailer = require('nodemailer');
const twilio = require('twilio');

/**
 * Centralized Phone Number Normalizer
 * Strips spaces/dashes, adds India country code +91 if 10 digits, and adds whatsapp: prefix if required
 */
function normalizePhoneNumber(phoneStr, forTwilioWhatsApp = false) {
  if (!phoneStr) return '';
  let cleaned = String(phoneStr).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  const formattedPhone = '+' + cleaned;
  return forTwilioWhatsApp ? `whatsapp:${formattedPhone}` : formattedPhone;
}

// Initialize Nodemailer transporter if env vars set
let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log('[NotificationService] Nodemailer SMTP initialized');
} else {
  console.log('[NotificationService] SMTP credentials not fully provided. Email simulation mode active.');
}

// Initialize Twilio client if env vars valid
let twilioClient = null;
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;

if (sid && token && sid.startsWith('AC')) {
  try {
    twilioClient = twilio(sid, token);
    console.log('[NotificationService] Twilio WhatsApp API initialized');
  } catch (e) {
    console.error('[NotificationService] Twilio init note:', e.message);
  }
} else {
  console.log('[NotificationService] Twilio credentials not provided or using simulation. WhatsApp simulation mode active.');
}

/**
 * Formats standard Daily EOD WhatsApp template
 */
function formatEODWhatsAppTemplate(data) {
  const leadName = data.leadName || 'Lead';
  const dateStr = data.date || new Date().toISOString().split('T')[0];
  const batch = data.batch || 'B-20';
  const attendance = data.attendance || '0/0';
  const teamChatCount = data.teamChatCount || 0;
  const callingAttendance = data.callingAttendance || '0/0';
  const chats = data.chats || 0;
  const calls = data.calls || 0;
  const personalChats = data.personalChatsDone || 0;
  const chatScan = data.chatScan || 0;
  const qcPosted = data.qcPosted || 0;
  const summary = data.summary || 'Daily operations completed.';

  return `*Team ${leadName}* - Date: ${dateStr}\n\n` +
         `*Batch: ${batch}*\n` +
         `Attendance: ${attendance}\n` +
         `Team Chat Count: ${teamChatCount}\n` +
         `*Calling OJT* Attendance: ${callingAttendance}\n` +
         `Chats: ${chats}\n` +
         `calls: ${calls}\n\n` +
         `━━━━━━━━━━━━━━━\n` +
         `*Personal Chats Done: ${personalChats} I Chat Scan: ${chatScan} | QC Posted: ${qcPosted}\n` +
         `━━━━━━━━━━━━━━━\n\n` +
         `*EOD Summary*\n` +
         `${summary}`;
}

/**
 * Formats WhatsApp Critical Error Alert
 */
function formatCriticalErrorAlert(traineeName, batch, errorCategory, leadName) {
  return `🚨 *Habuild OJT Quality Alert* 🚨\n` +
         `-----------------------------------\n` +
         `👤 *Trainee:* ${traineeName} (${batch})\n` +
         `👔 *Supervisor / Lead:* ${leadName}\n` +
         `❌ *Error Category:* ${errorCategory}\n` +
         `-----------------------------------\n` +
         `Immediate feedback and coaching recommended.`;
}

/**
 * Send WhatsApp Message
 */
async function sendWhatsAppMessage(toPhone, messageBody) {
  const targetPhoneFormatted = normalizePhoneNumber(toPhone, true);
  const rawFormatted = normalizePhoneNumber(toPhone, false);

  console.log(`[NotificationService] Processing WhatsApp for ${rawFormatted} (${targetPhoneFormatted})...`);

  if (twilioClient && process.env.TWILIO_WHATSAPP_NUMBER) {
    try {
      const fromPhone = normalizePhoneNumber(process.env.TWILIO_WHATSAPP_NUMBER, true);
      const result = await twilioClient.messages.create({
        from: fromPhone,
        to: targetPhoneFormatted,
        body: messageBody
      });
      console.log(`[NotificationService] WhatsApp sent via Twilio SID: ${result.sid}`);
      return { success: true, sid: result.sid, provider: 'Twilio', recipient: rawFormatted };
    } catch (err) {
      console.error('[NotificationService] Twilio send error:', err.message);
      return { success: false, error: err.message, provider: 'Twilio', recipient: rawFormatted };
    }
  }

  // Simulation mode return
  return {
    success: true,
    provider: 'SimulatedWhatsApp',
    to: rawFormatted,
    message: messageBody,
    note: 'Message formatted and logged (Add valid TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN in .env for live API sending)'
  };
}

/**
 * Send Email Summary
 */
async function sendEmailReport(toEmail, subject, htmlContent) {
  console.log(`[NotificationService] Processing Email for ${toEmail}...`);

  if (mailTransporter) {
    try {
      const info = await mailTransporter.sendMail({
        from: process.env.EMAIL_FROM || '"Habuild OJT System" <noreply@habuild.in>',
        to: toEmail,
        subject: subject,
        html: htmlContent
      });
      console.log(`[NotificationService] Email delivered. MessageID: ${info.messageId}`);
      return { success: true, messageId: info.messageId, provider: 'Nodemailer' };
    } catch (err) {
      console.error('[NotificationService] Email send error:', err.message);
      return { success: false, error: err.message, provider: 'Nodemailer' };
    }
  }

  // Simulation mode return
  return {
    success: true,
    provider: 'SimulatedEmail',
    to: toEmail,
    subject: subject,
    note: 'Email formatted and logged (Add SMTP settings in .env for live email sending)'
  };
}

module.exports = {
  normalizePhoneNumber,
  formatEODWhatsAppTemplate,
  formatCriticalErrorAlert,
  sendWhatsAppMessage,
  sendEmailReport
};
