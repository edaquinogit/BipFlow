from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0052_shipping_logistics_foundation")]
    operations = [
        migrations.AddField(
            model_name="saleorder",
            name="shipping_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
