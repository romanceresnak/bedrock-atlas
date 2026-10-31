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

module "location_map" {
  source = "../../modules/location_map"

  region           = "eu-central-1"
  allowed_referers = concat(var.map_allowed_referers, ["https://${module.web_hosting.domain_name}/*"])
}

module "web_hosting" {
  source = "../../modules/web_hosting"

  region     = "eu-central-1"
  api_domain = module.live_demo.api_domain
}

module "live_demo" {
  source = "../../modules/live_demo"

  region     = "eu-central-1"
  log_groups = { for r, m in module.bedrock_logging : r => m.log_group_name }
  model_ids  = var.model_ids
  daily_cap  = 500
}

module "budget" {
  source = "../../modules/budget"

  monthly_limit_usd = 10
  email             = var.budget_email
}
