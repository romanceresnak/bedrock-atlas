# Browser-safe API key: map tiles only, provider map only, our referers only.
# The hashicorp/aws provider has no API key resource, so we use awscc
# (Cloud Control, AWS::Location::APIKey).

resource "awscc_location_api_key" "map" {
  key_name    = "bedrock-atlas-map"
  description = "Bedrock Atlas web map (tiles only)"
  no_expiry   = true

  restrictions = {
    allow_actions   = ["geo-maps:GetTile"]
    allow_resources = ["arn:aws:geo-maps:${var.region}::provider/default"]
    allow_referers  = var.allowed_referers
  }
}
