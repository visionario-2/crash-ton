import hmac, hashlib, struct

HOUSE_EDGE = 0.01  # 1%

def hmac_sha256(key: str, msg: str) -> bytes:
    return hmac.new(key.encode(), msg.encode(), hashlib.sha256).digest()

def hash_to_uniform01(digest: bytes) -> float:
    integer = struct.unpack(">Q", digest[:8])[0]
    return (integer + 1) / (2**64)  # (0,1]

def crash_point(server_seed: str, client_seed: str, nonce: int) -> float:
    digest = hmac_sha256(server_seed, f"{client_seed}:{nonce}")
    r = hash_to_uniform01(digest)
    x = ((1.0 - HOUSE_EDGE) / r)
    return max(1.00, round((int(x * 100)) / 100.0, 2))
