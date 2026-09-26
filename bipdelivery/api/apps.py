from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "bipdelivery.api"

    def ready(self) -> None:
        from . import checks  # noqa: F401
        from . import signals  # noqa: F401
