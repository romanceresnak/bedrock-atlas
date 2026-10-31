output "api_domain" {
  description = "API Gateway hostname, used as a CloudFront origin for /api/*."
  value       = replace(aws_apigatewayv2_api.live.api_endpoint, "https://", "")
}
