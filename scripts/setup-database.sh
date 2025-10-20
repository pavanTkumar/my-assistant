#!/bin/bash

echo "🗄️  Setting up database..."
echo ""

# Generate Prisma Client
echo "📦 Generating Prisma Client..."
npx prisma generate

# Push schema to database
echo "🔄 Pushing schema to database..."
npx prisma db push

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Verify database in Vercel dashboard"
echo "2. Run: npm run seed-meeting-types"
echo "3. Test database connection"