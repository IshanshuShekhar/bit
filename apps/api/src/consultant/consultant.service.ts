import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { PaymentService } from '../payment/payment.service';
import { EmailService } from '../email/email.service';
import { CreateBookingDto, LogCallDto } from './consultant.dto';

/** Fixed available time slots (server-side config — no full calendar needed for hackathon) */
const AVAILABLE_SLOTS = [
  { id: 'slot_1', label: 'Mon 07 Oct · 10:00 AM IST', isoUtc: '2026-10-07T04:30:00Z' },
  { id: 'slot_2', label: 'Mon 07 Oct · 3:00 PM IST',  isoUtc: '2026-10-07T09:30:00Z' },
  { id: 'slot_3', label: 'Tue 08 Oct · 10:00 AM IST', isoUtc: '2026-10-08T04:30:00Z' },
  { id: 'slot_4', label: 'Tue 08 Oct · 3:00 PM IST',  isoUtc: '2026-10-08T09:30:00Z' },
  { id: 'slot_5', label: 'Wed 09 Oct · 11:00 AM IST', isoUtc: '2026-10-09T05:30:00Z' },
  { id: 'slot_6', label: 'Thu 10 Oct · 10:00 AM IST', isoUtc: '2026-10-10T04:30:00Z' },
  { id: 'slot_7', label: 'Fri 11 Oct · 2:00 PM IST',  isoUtc: '2026-10-11T08:30:00Z' },
  { id: 'slot_8', label: 'Sat 12 Oct · 10:00 AM IST', isoUtc: '2026-10-12T04:30:00Z' },
];

const CONSULTATION_TOPICS = [
  'German University Application Process',
  'Visa & APS Document Verification',
  'Language Certificate Requirements',
  'Blocked Account & Finances Setup',
  'Finding Study Programs (Anabin H+)',
  'Work & Study Pathway in Germany',
  'Other / General Guidance',
];

@Injectable()
export class ConsultantService {
  private readonly logger = new Logger(ConsultantService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /** Returns static consultant info — phone number from env, never hardcoded in UI */
  getInfo() {
    return {
      name: 'Educaro Senior Immigration Consultant',
      phone: this.config.get<string>('CONSULTANT_PHONE_NUMBER') ?? '',
      avatarInitials: 'EC',
      topics: CONSULTATION_TOPICS,
    };
  }

  /** Returns available booking slots */
  getSlots() {
    return AVAILABLE_SLOTS;
  }

  /** Gate: throws 403 if user does not hold an active Premium entitlement */
  private async assertPremium(userId: string) {
    const active = await this.paymentService.checkServerAccess(userId);
    if (!active) {
      throw new ForbiddenException(
        'Consultant access requires an active Educaro Premium entitlement.',
      );
    }
  }

  /** Create a booking for the authenticated applicant */
  async createBooking(userId: string, dto: CreateBookingDto) {
    await this.assertPremium(userId);

    const id = uuidv4();
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO consultant_bookings (id, user_id, consultant_id, scheduled_at, topic, notes, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'booked', $7, $7)`,
      [id, userId, 'primary', dto.scheduledAt, dto.topic ?? null, dto.notes ?? null, now],
    );

    this.logger.log(`Booking created: ${id} for user ${userId} at ${dto.scheduledAt}`);

    // Fetch user email for confirmation email
    const userRes = await this.db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length > 0) {
      const email = userRes.rows[0].email;
      const slotLabel = AVAILABLE_SLOTS.find((s) => s.id === dto.scheduledAt)?.label || dto.scheduledAt;

      // Fire and forget email — don't await/throw so booking still succeeds if email fails
      this.emailService.send({
        to: email,
        subject: 'Consultation Confirmation: Educaro Premium 1-on-1',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #F5F5EF; border-radius: 16px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h2 style="color: #344653; font-size: 20px; margin: 12px 0 4px;">Booking Confirmed!</h2>
              <p style="color: #71808A; font-size: 13px; margin: 0;">Your 1-on-1 Strategy Call is scheduled.</p>
            </div>
            <div style="background: #EEF1EB; border: 1px solid #DCE2DC; border-radius: 12px; padding: 24px;">
              <p style="color: #344653; font-size: 14px; margin: 0 0 8px;"><strong>Consultation:</strong> Educaro Premium 1-on-1 Senior Consultant Strategy Call</p>
              <p style="color: #344653; font-size: 14px; margin: 0 0 8px;"><strong>Date/Time:</strong> ${slotLabel}</p>
              <p style="color: #344653; font-size: 14px; margin: 0 0 8px;"><strong>Topic:</strong> ${dto.topic || 'General Guidance'}</p>
              ${dto.notes ? `<p style="color: #344653; font-size: 14px; margin: 0;"><strong>Notes:</strong> ${dto.notes}</p>` : ''}
            </div>
            <p style="color: #71808A; font-size: 11px; text-align: center; margin-top: 20px;">© EduRoute AI — Your Germany immigration journey starts here.</p>
          </div>
        `
      }).catch(err => {
        this.logger.error(`Failed to send booking confirmation to ${email}: ${err.message}`);
      });
    }

    return {
      id,
      userId,
      consultantId: 'primary',
      scheduledAt: dto.scheduledAt,
      topic: dto.topic,
      notes: dto.notes,
      status: 'booked',
      createdAt: now,
    };
  }

  /** Get all bookings for the authenticated applicant */
  async getMyBookings(userId: string) {
    await this.assertPremium(userId);
    const result = await this.db.query(
      `SELECT * FROM consultant_bookings WHERE user_id = $1 ORDER BY scheduled_at ASC`,
      [userId],
    );
    return result.rows;
  }

  /** Cancel a booking */
  async cancelBooking(userId: string, bookingId: string) {
    await this.assertPremium(userId);

    const res = await this.db.query(
      `SELECT id FROM consultant_bookings WHERE id = $1 AND user_id = $2`,
      [bookingId, userId],
    );
    if (!res.rows.length) {
      throw new NotFoundException('Booking not found or does not belong to this user.');
    }

    await this.db.query(
      `UPDATE consultant_bookings SET status = 'cancelled', updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), bookingId],
    );
    return { success: true, bookingId };
  }

  /** Log a "Call Now" tap — no Twilio needed, just records intent for consultant visibility */
  async logCall(userId: string, dto: LogCallDto) {
    await this.assertPremium(userId);

    const id = uuidv4();
    const now = new Date().toISOString();
    const phone = this.config.get<string>('CONSULTANT_PHONE_NUMBER') ?? '';

    await this.db.query(
      `INSERT INTO consultant_call_logs (id, user_id, consultant_id, initiated_at, booking_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, 'primary', now, dto.bookingId ?? null],
    );

    this.logger.log(`Call initiated by user ${userId} → ${phone} at ${now}`);

    return {
      id,
      initiatedAt: now,
      consultantPhone: phone,
      message: 'Call attempt logged. Your device dialer should open automatically.',
    };
  }

  /** Get call log for the authenticated applicant */
  async getMyCallLog(userId: string) {
    await this.assertPremium(userId);
    const result = await this.db.query(
      `SELECT * FROM consultant_call_logs WHERE user_id = $1 ORDER BY initiated_at DESC`,
      [userId],
    );
    return result.rows;
  }
}
