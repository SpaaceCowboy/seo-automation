Roco SEO — Project Brief
Purpose
Roco SEO is an internal SEO intelligence and automation platform for RocoBroker.
The existing RocoBroker website is already developed. This system operates alongside the website and continuously:

- crawls the website
- monitors technical SEO
- imports Google search/performance data
- identifies SEO opportunities
- prioritizes opportunities
- generates recommendations
- sends recommendations for human approval
- records implemented changes
- measures results
- improves future recommendations using historical results
  The source proposal is located at:
  docs/reference/Roco_SEO_Automation_Proposal_FA_Detailed.pdf
  Target Architecture
  Existing RocoBroker Website
  ↓
  SEO Crawler
  ↓
  PostgreSQL SEO Data Store
  ↓
  Google Search Console / Google Analytics 4 / PageSpeed Insights
  ↓
  Opportunity Engine
  ↓
  SEO Supervisor
  ↓
  Specialized SEO Agents
  ↓
  Recommendations
  ↓
  Human Approval
  ↓
  Change Ledger
  ↓
  30 / 60 / 90 Day Measurement
  ↓
  Feedback / Learning
  Initial SEO Agents
  SEO Supervisor
  Coordinates analysis and determines which opportunities deserve attention.
  Technical SEO Agent
  Analyzes technical SEO issues.
  Opportunity / Keyword Agent
  Analyzes search queries, rankings, CTR, quick wins, keyword opportunities, cannibalization, and topic opportunities.
  Content Agent
  Suggests title improvements, meta descriptions, headings, content structure, content gaps, and FAQ opportunities.
  Internal Linking Agent
  Finds orphan pages, weakly linked important pages, relevant source pages, and suitable internal-linking opportunities.
  Technical SEO Data
  The crawler should eventually inspect:
- HTTP status
- redirect chains
- canonical
- robots.txt
- meta robots
- X-Robots-Tag
- sitemap membership
- indexability
- title
- meta description
- H1
- H2
- schema
- breadcrumb
- image alt attributes
- word count
- internal links
- incoming internal links
- crawl depth
- orphan pages
- response time
- content changes
  Every crawl should create historical snapshots.
  Google Data
  Google Search Console
  Store historical:
- date
- page
- query
- country
- device
- clicks
- impressions
- CTR
- average position
  Google Analytics 4
  Store relevant organic landing-page performance and engagement metrics.
  PageSpeed Insights
  Track mobile and desktop performance, including relevant Core Web Vitals.
  Opportunity Types
  Quick Wins
  Queries/pages with meaningful impressions and rankings close to stronger positions.
  CTR Opportunities
  Pages that rank reasonably well but receive unusually low CTR.
  Content Gaps
  Queries where RocoBroker receives impressions but existing content does not fully satisfy the search intent.
  Cannibalization
  Multiple URLs competing for the same or very similar intent.
  Decay Detection
  Pages or queries experiencing meaningful performance decline.
  Internal Linking Opportunities
  Relevant strong pages capable of supporting important target pages through internal links.
  Opportunity Scoring
  Opportunity scoring should consider:
- Search Demand
- Impact
- Confidence
- Effort
- Business Value
  Weights must remain configurable. Do not permanently hardcode scoring assumptions.
  Change Control
  Level 1 — Automatic
- crawling
- monitoring
- data collection
- reporting
- deterministic analysis
  Level 2 — Human approval required
- title changes
- meta descriptions
- internal links
- schema
- FAQ
- content improvements
  Level 3 — Manual / special approval
- URL changes
- page deletion
- major redirects
- major rewrites
  During the MVP, no production SEO change should be automatically deployed.
  Change Ledger
  Every approved SEO change should eventually record:
- URL
- page type
- target query/topic
- recommendation
- reason
- confidence
- before value
- after value
- suggestion date
- approval date
- execution date
- responsible person/agent
- baseline metrics
- 30-day measurement
- 60-day measurement
- 90-day measurement
- final result
  Possible result states:
- POSITIVE
- NEUTRAL
- NEGATIVE
- INSUFFICIENT_DATA
- REVERTED
  MVP
  The initial MVP should establish:

1. Reliable crawler
2. PostgreSQL historical storage
3. Technical SEO checks
4. Internal-link graph
5. Google Search Console integration
6. GA4 integration
7. PageSpeed integration
8. Opportunity Engine
9. Opportunity scoring
10. SEO Supervisor
11. Recommendations
12. Human approval workflow
13. Change Ledger
14. Measurement scheduling
15. Private internal dashboard
    Autonomous production modifications are not part of the initial MVP.
    Dashboard
    The project should eventually provide a private internal SEO Control Center.
    Primary areas:

- SEO health
- crawl status
- search performance
- technical problems
- opportunities
- approval queue
- Change Ledger
- alerts
- measurement results
  Prefer one focused control-center experience rather than a large complex admin application.
  Core Principle
  The purpose of Roco SEO is not to generate large quantities of AI content.
  The purpose is to create a measurable SEO decision system:
  Detect → Understand → Prioritize → Recommend → Approve → Execute → Measure → LearnS
