output "key_name" {
  description = "Read the key value with: aws location describe-key --key-name <name> --query Key --output text"
  value       = awscc_location_api_key.map.key_name
}
