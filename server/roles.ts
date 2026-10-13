export type OrganizationRole = 'owner' | 'admin' | 'member'

export type AuthContext = {
  sessionId: string
  userId: string
  email: string
  displayName: string
}
