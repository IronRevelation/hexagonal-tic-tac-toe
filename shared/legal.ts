import type { PrivacyInfo } from './contracts'

export const SITE_NAME = 'Hexagonal Tic-Tac-Toe Online'
export const CONTROLLER_NAME = SITE_NAME
export const CONTACT_EMAIL = 'hextictactoe@gmail.com'
export const CONTROLLER_LOCATION = 'EU-based individual developer'
export const MINIMUM_AGE = 16
export const PRIVACY_EFFECTIVE_DATE = '2026-03-08'

export const PRIVACY_INFO: PrivacyInfo = {
  siteName: SITE_NAME,
  controllerName: CONTROLLER_NAME,
  contactEmail: CONTACT_EMAIL,
  controllerLocation: CONTROLLER_LOCATION,
  minimumAge: MINIMUM_AGE,
  effectiveDate: PRIVACY_EFFECTIVE_DATE,
  legalBases: [
    'Performance of a contract or steps requested by the user to provide matchmaking, room joins, live gameplay, and anti-disconnect handling.',
    'Legitimate interests for basic service security, abuse prevention, and short retention needed to keep game state consistent.',
  ],
  dataCategories: [
    'Anonymous guest identifier stored on the device and a hashed copy of that identifier on the backend.',
    'Generated guest display name, gameplay records, room codes, participation history, and short-lived active-game presence state.',
    'Infrastructure metadata handled by hosting providers such as IP address and access logs.',
  ],
  purposes: [
    'Create and maintain anonymous guest sessions.',
    'Run public matchmaking, private rooms, rematches, and spectator access.',
    'Maintain live game state, move history, and active-game disconnect detection when a player stops actively viewing the game during their turn.',
    'Handle privacy requests, security incidents, and abuse prevention.',
  ],
  rights: [
    'Access your data.',
    'Request erasure of your guest profile.',
    'Receive an export of your data in JSON format.',
    'Object to processing based on legitimate interests where applicable.',
    'Lodge a complaint with your local supervisory authority.',
  ],
  processors: [
    {
      name: 'Convex',
      purpose: 'Backend database, real-time sync, and scheduled cleanup jobs.',
      location:
        'May process or transfer data in the United States and other regions permitted by its DPA and subprocessors list.',
    },
    {
      name: 'Upstash',
      purpose: 'Ephemeral Redis-based presence tracking used only for disconnect-forfeit checks.',
      location:
        'May process or transfer data in the United States and other regions permitted by its DPA and subprocessors list.',
    },
    {
      name: 'Vercel',
      purpose: 'Frontend hosting and delivery.',
      location:
        'Primary processing facilities are in the United States, with possible processing in other regions used by Vercel or its subprocessors.',
    },
  ],
  internationalTransfers: [
    'If hosting or infrastructure providers process personal data outside your country, transfers are handled under the provider data processing terms and applicable transfer safeguards.',
    'Convex states in its DPA that customer personal data may be transferred across borders, including from the EEA, Switzerland, and the UK to the United States.',
    'Upstash states in its terms and infrastructure documentation that Redis and related services may process data in regions outside your country depending on the deployment and provider setup.',
    'Vercel states in its DPA that its primary processing facilities are in the United States and that cross-border transfers rely on its DPA transfer mechanisms, including SCC and UK transfer terms where required.',
  ],
  retention: [
    {
      key: 'queue',
      label: 'Matchmaking queue entries',
      duration: '24 hours',
      details: 'Queue entries older than 24 hours are automatically deleted.',
    },
    {
      key: 'waitingRooms',
      label: 'Unused private rooms',
      duration: '7 days',
      details:
        'Waiting private rooms with no second player are automatically deleted after 7 days of inactivity.',
    },
    {
      key: 'finishedGames',
      label: 'Finished games and move history',
      duration: '30 days',
      details:
        'Finished games, participant rows, and moves are deleted 30 days after the game ends.',
    },
    {
      key: 'guestProfiles',
      label: 'Guest profiles',
      duration: '30 days',
      details:
        'Inactive guest profiles are deleted after 30 days when they are no longer referenced by queue or game participation records.',
    },
  ],
  complaintText:
    'If you believe your data has been handled unlawfully, you can contact us first or complain to the supervisory authority in your EU/EEA country of residence.',
  analyticsEnabled: false,
}
