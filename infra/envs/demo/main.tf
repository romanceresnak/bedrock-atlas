module "team_roles" {
  source = "../../modules/team_roles"

  teams     = var.teams
  model_ids = var.model_ids
}

module "bedrock_logging" {
  source   = "../../modules/bedrock_logging"
  for_each = var.source_regions

  region = each.key
}

module "cloudtrail" {
  source = "../../modules/cloudtrail"

  region = "eu-central-1"
}
