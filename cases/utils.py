from datetime import datetime
import uuid


def generate_case_number() -> str:
    return datetime.utcnow().strftime("CASE-%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6].upper()
