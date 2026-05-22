/**
 * Run once to create the admin account:
 *   node scripts/setup-admin.js
 *
 * Reads MONGODB_URI, ADMIN_USERNAME, ADMIN_PASSWORD from .env.local
 */
require('dotenv').config({ path: '.env.local' })
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

async function main() {
  const uri = process.env.MONGODB_URI
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD

  if (!uri || !username || !password) {
    console.error('Set MONGODB_URI, ADMIN_USERNAME, and ADMIN_PASSWORD in .env.local')
    process.exit(1)
  }

  await mongoose.connect(uri)

  const AdminSchema = new mongoose.Schema({ username: String, passwordHash: String })
  const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema)

  const passwordHash = await bcrypt.hash(password, 12)
  await Admin.findOneAndUpdate(
    { username },
    { username, passwordHash },
    { upsert: true, new: true }
  )

  console.log(`Admin account "${username}" created/updated.`)
  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
