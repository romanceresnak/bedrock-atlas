output "team_role_arns" {
  value = module.team_roles.role_arns
}

output "invocation_log_buckets" {
  value = { for r, m in module.bedrock_logging : r => m.bucket }
}

output "cloudtrail_bucket" {
  value = module.cloudtrail.bucket
}

output "map_key_name" {
  value = module.location_map.key_name
}

output "web_bucket" {
  value = module.web_hosting.bucket
}

output "web_distribution_id" {
  value = module.web_hosting.distribution_id
}

output "web_url" {
  value = "https://${module.web_hosting.domain_name}"
}
