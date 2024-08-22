from neo4j import GraphDatabase

# Connect to the Neo4j instance
uri = "your_neo4j_url"  # Replace with your Neo4j URL
username = "your_username"  # Replace with your Neo4j username
password = "your_password"  # Replace with your Neo4j password
driver = GraphDatabase.driver(uri, auth=(username, password))

# Function to delete tagged nodes
def delete_tagged_nodes(tx, tag):
    tx.run(f"MATCH (n) WHERE n.{tag} = true DETACH DELETE n")
    print(f"Deleted nodes with tag: {tag}")

# Tag to identify nodes to be deleted
tag = "added_for_bulletin"

# Execute the deletion
with driver.session(database="newDatabase") as session:
    session.write_transaction(delete_tagged_nodes, tag)

print("Deletion completed successfully.")

# Close the driver connection
driver.close()
