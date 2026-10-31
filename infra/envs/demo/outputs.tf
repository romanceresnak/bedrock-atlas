output "team_role_arns" {
  value = module.team_roles.role_arns
}

output "invocation_log_buckets" {
  value = { for r, m in module.bedrock_logging : r => m.bucket }
}

output "cloudtrail_bucket" {
  value = module.cloudtrail.bucket
}
