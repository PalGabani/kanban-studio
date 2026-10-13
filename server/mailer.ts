import nodemailer from 'nodemailer'
import { config } from './config.js'

const transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER ? {
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASSWORD ?? '',
        },
      } : {}),
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  : null

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

export async function sendOrganizationInvite(email: string, organizationName: string, token: string) {
  if (!transporter) {
    throw new Error('Email delivery is not configured. Set SMTP_HOST before sending invitations.')
  }
  const inviteUrl = new URL('/invite', config.APP_ORIGIN)
  inviteUrl.searchParams.set('token', token)
  const safeOrganizationName = escapeHtml(organizationName)
  await transporter.sendMail({
    from: config.MAIL_FROM,
    to: email,
    subject: `You are invited to join ${organizationName} on Kanban Studio`,
    text: `You have been invited to join ${organizationName} on Kanban Studio. Accept the invitation: ${inviteUrl.href}\n\nThis invitation expires in ${config.INVITATION_TTL_HOURS} hours. If you were not expecting this email, you can ignore it.`,
    html: `<p>You have been invited to join <strong>${safeOrganizationName}</strong> on Kanban Studio.</p><p><a href="${escapeHtml(inviteUrl.href)}">Accept invitation</a></p><p>This invitation expires in ${config.INVITATION_TTL_HOURS} hours. If you were not expecting this email, you can ignore it.</p>`,
  })
}
