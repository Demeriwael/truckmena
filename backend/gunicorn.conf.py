"""One cache/limiter process; threads keep health checks responsive during I/O."""

import os

bind = f"0.0.0.0:{int(os.getenv('PORT', '10000'))}"
workers = 1
worker_class = "gthread"
threads = 4
timeout = 120
graceful_timeout = 30
keepalive = 5
accesslog = None  # Do not log submitted address searches in request URLs.
errorlog = "-"
loglevel = "info"
