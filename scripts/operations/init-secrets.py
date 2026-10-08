#!/usr/bin/env python3
"""One-time host provisioning; never replaces existing secrets."""
import json, os, pathlib, secrets, sys, uuid

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/roco-seo')
name = sys.argv[2] if len(sys.argv) > 2 else 'Initial operator'
secret_dir, config_dir, operations = root/'secrets', root/'config', root/'operations'
for p in [secret_dir, config_dir, operations]:
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
if (secret_dir/'database_url').exists():
    raise SystemExit('Secrets already exist; refusing to overwrite or rotate them')
human, service = str(uuid.uuid4()), str(uuid.uuid4())
password, admin = secrets.token_hex(32), secrets.token_hex(32)
access = [{'actorId': human, 'roles': ['VIEWER','OPERATOR','APPROVER','SPECIAL_APPROVER'], 'token': secrets.token_hex(32)}]
values = {
    'database_password': password, 'postgres_password': admin,
    'database_url': f'postgresql://roco_seo:{password}@postgres:5432/roco_seo',
    'workflow_access': json.dumps(access),
    'opportunity_token': secrets.token_hex(32), 'agent_token': secrets.token_hex(32), 'llm_openai_key': '', 'pagespeed_key': '',
}
for key, value in values.items():
    path = secret_dir/key
    with path.open('x') as f: f.write(value+'\n')
    # Parent 0700 restricts host access; Compose file mounts retain this mode for non-root container readers.
    os.chmod(path, 0o444)
google = secret_dir/'google'
google.mkdir(mode=0o700)
os.chown(google, 1000, 1000)
identity = operations/'identities.json'
identity.write_text(json.dumps([{'id': human, 'type': 'HUMAN', 'name': name}, {'id': service, 'type': 'SERVICE', 'name': 'Roco measurement worker'}]))
os.chmod(identity, 0o600)
os.chown(operations, 1000, 1000)
os.chown(identity, 1000, 1000)
env = config_dir/'production.env'
with env.open('x') as f:
    f.write(f'''LOG_LEVEL=info
CRAWLER_MAX_PAGES=500
CRAWLER_CONCURRENCY=1
CRAWLER_REQUESTS_PER_SECOND=0.5
CRAWLER_MAX_DEPTH=10
GOOGLE_SCHEDULES_ENABLED=false
GOOGLE_FINALITY_DAYS=3
WORKFLOW_SCHEDULES_ENABLED=true
WORKFLOW_MEASUREMENT_ACTOR_ID={service}
OPPORTUNITY_ACTOR_ID={human}
AGENT_ACTOR_ID={human}
AGENTS_ENABLED=false
''')
os.chmod(env, 0o600)
print('Created scoped secrets and named identities. No secret values were printed.')
